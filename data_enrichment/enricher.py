import json
import os
import time
from pathlib import Path
import logging
import google.generativeai as genai
import ollama
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- Configuration ---
# Directories
INPUT_BASE_DIR = Path("/app/data")
OUTPUT_BASE_DIR = Path("/app/data")
SOURCES = ["app", "dawn"]
INPUT_SUBDIR = "transformed_articles"
OUTPUT_SUBDIR = "transformed_articles_ner"

# --- Provider Configuration ---
ENRICHMENT_PROVIDER = os.environ.get("ENRICHMENT_PROVIDER", "google").lower()
OLLAMA_API_URL = os.environ.get("OLLAMA_API_URL")
OLLAMA_MODEL_NAME = os.environ.get("OLLAMA_MODEL", "gemma3:12b") # Default model for Ollama
MAX_RETRIES = 3
INITIAL_BACKOFF = 2 # seconds
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", 10))

# Google Gemini API Configuration
GEMINI_MODEL_NAME = "gemini-1.5-flash-latest" # Updated model name
if ENRICHMENT_PROVIDER == "google":
    try:
        GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]
        genai.configure(api_key=GOOGLE_API_KEY)
    except KeyError:
        raise EnvironmentError("ENRICHMENT_PROVIDER is 'google' but GOOGLE_API_KEY environment variable is not set.")

# Ollama Client Configuration
if ENRICHMENT_PROVIDER == "ollama":
    if not OLLAMA_API_URL:
        raise EnvironmentError("ENRICHMENT_PROVIDER is 'ollama' but OLLAMA_API_URL environment variable is not set.")
    try:
        ollama_client = ollama.Client(host=OLLAMA_API_URL)
    except Exception as e:
        raise ConnectionError(f"Failed to create Ollama client at {OLLAMA_API_URL}: {e}")


# Logging
LOG_DIR = Path("./logs")
LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "enricher.log"),
        logging.StreamHandler()
    ]
)

# --- Prompt Template ---
SYSTEM_PROMPT = """
You are a meticulous NLP and Knowledge Graph analyst. Your task is to process a given news article and extract structured information with high precision.

You must follow these instructions exactly.

1. Core Instructions
Input: You will be given a single JSON object containing a news article.

Processing: You must only use the text in the content.article_body field to perform your tasks. Do not use the title, summary, or any other metadata.

Output: Your output must be a single, valid JSON object. Any other text, apologies, or explanations are forbidden.

2. Step-by-Step Task Logic
You will perform the following steps in order:

Read: First, read the content.article_body text carefully.

Extract & De-duplicate: Identify all named entities and classify them as PERSON, ORGANIZATION, or LOCATION. You must then de-duplicate them. For example, if "Bilawal Bhutto Zardari" is mentioned 5 times, he should have only one entry in your final entities list.

Link (WikiData): For each unique entity, you must try to find its corresponding WikiData ID.

Crucial: You must be very cautious. If an entity is ambiguous (e.g., "John Smith") or not prominent enough to have a clear WikiData entry (e.g., a local figure not on Wikipedia), you must use null.

It is better to use null than to guess a wrong ID.

Analyze Sentiment: For each unique entity, analyze all its mentions and the surrounding context within the article to determine its overall sentiment. The sentiment must be one of: Positive, Negative, or Neutral.

Generate Keywords: Generate an array of 5-7 significant keywords. These should include the most important concepts (e.g., "AI regulation," "online safety") as well as the most central named entities.

Summarize: Generate a 2-3 sentence, high-level summary that describes the main event or topic of the article.

Format Output: Assemble all extracted information into the single JSON object specified below.

3. Final Output Schema
Your output must be a single JSON object using only these keys and structures:
"""

USER_PROMPT_TEMPLATE = """
Here is the article to process:

{article_json}
"""

def get_gemini_response(article_json_str: str) -> dict | None:
    """
    Sends the article to the Google Gemini model and returns the parsed JSON response.
    Includes retry logic with exponential backoff.
    """
    user_prompt = USER_PROMPT_TEMPLATE.format(article_json=article_json_str)
    
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL_NAME,
        system_instruction=SYSTEM_PROMPT,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.1
        )
    )

    for attempt in range(MAX_RETRIES):
        try:
            logging.info("Sending request to Google Gemini model...")
            response = model.generate_content(user_prompt)
            response_text = response.text
            parsed_content = json.loads(response_text)
            logging.info("Successfully received and parsed response from Gemini.")
            return parsed_content
        except Exception as e:
            logging.error(f"Google Gemini API request failed on attempt {attempt + 1}/{MAX_RETRIES}: {e}")
            if 'response' in locals():
                logging.error(f"Prompt Feedback: {getattr(response, 'prompt_feedback', 'N/A')}")
                logging.error(f"Candidates: {getattr(response, 'candidates', 'N/A')}")
            if attempt < MAX_RETRIES - 1:
                backoff_time = INITIAL_BACKOFF * (2 ** attempt)
                logging.info(f"Retrying in {backoff_time} seconds...")
                time.sleep(backoff_time)
            else:
                logging.error("Max retries reached for Gemini API. Giving up.")
    return None

def get_ollama_response(article_json_str: str) -> dict | None:
    """
    Sends the article to the Ollama model and returns the parsed JSON response.
    Includes retry logic with exponential backoff.
    """
    user_prompt = USER_PROMPT_TEMPLATE.format(article_json=article_json_str)
    
    for attempt in range(MAX_RETRIES):
        try:
            logging.info(f"Sending request to Ollama model '{OLLAMA_MODEL_NAME}' at {OLLAMA_API_URL}...")
            response = ollama_client.chat(
                model=OLLAMA_MODEL_NAME,
                messages=[
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': user_prompt}
                ],
                format='json'
            )
            
            # The response from the ollama library is already a dict
            response_text = response['message']['content']
            parsed_content = json.loads(response_text)
            
            logging.info("Successfully received and parsed response from Ollama.")
            return parsed_content

        except Exception as e:
            logging.error(f"Ollama API request failed on attempt {attempt + 1}/{MAX_RETRIES}: {e}")
            if attempt < MAX_RETRIES - 1:
                backoff_time = INITIAL_BACKOFF * (2 ** attempt)
                logging.info(f"Retrying in {backoff_time} seconds...")
                time.sleep(backoff_time)
            else:
                logging.error("Max retries reached for Ollama API. Giving up.")
    return None


def get_model_response(article_json_str: str) -> dict | None:
    """
    Dispatcher function to select the correct enrichment provider.
    """
    if ENRICHMENT_PROVIDER == "google":
        return get_gemini_response(article_json_str)
    elif ENRICHMENT_PROVIDER == "ollama":
        return get_ollama_response(article_json_str)
    else:
        logging.error(f"Invalid ENRICHMENT_PROVIDER: '{ENRICHMENT_PROVIDER}'. Must be 'google' or 'ollama'.")
        return None


def process_article_file(input_path: Path, output_path: Path):
    """
    Reads an article, enriches it using the selected model, and saves the new version.
    """
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        article_body = data.get("content", {}).get("article_body")
        if not article_body or not isinstance(article_body, str) or len(article_body.strip()) < 50:
            logging.warning(f"Skipping {input_path.name}, article body is empty or too short.")
            return

        # Pass the entire JSON object as a string to the model
        article_json_str = json.dumps(data)
        enriched_data = get_model_response(article_json_str)

        if enriched_data:
            # Update the original JSON data with the new fields
            # The structure of the 'entities' field is now a dict of lists of objects
            data["content"]["summary"] = enriched_data.get("summary", "")
            data["content"]["keywords"] = enriched_data.get("keywords", [])
            data["entities"] = enriched_data.get("entities", {"people": [], "organizations": [], "locations": []})
            
            # Ensure output directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        else:
            logging.error(f"Failed to get enrichment data for {input_path.name}.")

    except json.JSONDecodeError:
        logging.error(f"Skipping corrupted JSON file: {input_path}")
    except Exception as e:
        logging.error(f"An unexpected error occurred while processing {input_path.name}: {e}")


def main():
    """
    Main function to walk through directories and process files concurrently.
    """
    logging.info(f"Starting data enrichment process using provider: {ENRICHMENT_PROVIDER.upper()}")
    logging.info(f"Using up to {MAX_WORKERS} parallel workers.")

    for source in SOURCES:
        input_dir = INPUT_BASE_DIR / source / INPUT_SUBDIR
        output_dir = OUTPUT_BASE_DIR / source / OUTPUT_SUBDIR

        if not input_dir.is_dir():
            logging.warning(f"Input directory not found, skipping: {input_dir}")
            continue

        logging.info(f"Processing source: {source}")

        # Get list of files to process (delta check)
        input_files = sorted([f for f in input_dir.glob("**/*.json") if f.is_file()])
        
        files_to_process = []
        for in_file in input_files:
            out_file = output_dir / in_file.relative_to(input_dir)
            if not out_file.exists():
                files_to_process.append((in_file, out_file))

        if not files_to_process:
            logging.info(f"No new files to process for source '{source}'.")
            continue
            
        logging.info(f"Found {len(files_to_process)} new files to process for source '{source}'.")

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            # Submit all processing tasks to the executor
            future_to_file = {executor.submit(process_article_file, in_file, out_file): in_file.name for in_file, out_file in files_to_process}
            
            processed_count = 0
            total_files = len(files_to_process)
            
            for future in as_completed(future_to_file):
                file_name = future_to_file[future]
                processed_count += 1
                try:
                    future.result()  # Check for exceptions
                    logging.info(f"({processed_count}/{total_files}) Successfully processed {file_name}")
                except Exception as exc:
                    logging.error(f"({processed_count}/{total_files}) {file_name} generated an exception: {exc}")

    logging.info("Data enrichment process finished.")


if __name__ == "__main__":
    main()
