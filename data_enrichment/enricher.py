import json
import os
import time
from pathlib import Path
import requests
import logging

# --- Configuration ---
# Directories
INPUT_BASE_DIR = Path("/data")
OUTPUT_BASE_DIR = Path("/data")
SOURCES = ["app", "dawn"]
INPUT_SUBDIR = "transformed_articles"
OUTPUT_SUBDIR = "transformed_articles_ner"

# Llama Model API
LLAMA_API_URL = os.environ.get("LLAMA_API_URL", "http://localhost:11434/v1/chat/completions")
import json
import os
import time
from pathlib import Path
import logging
import google.generativeai as genai

# --- Configuration ---
# Directories
INPUT_BASE_DIR = Path("/data")
OUTPUT_BASE_DIR = Path("/data")
SOURCES = ["app", "dawn"]
INPUT_SUBDIR = "transformed_articles"
OUTPUT_SUBDIR = "transformed_articles_ner"

# Google Gemini API
try:
    GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]
    genai.configure(api_key=GOOGLE_API_KEY)
except KeyError:
    raise EnvironmentError("GOOGLE_API_KEY environment variable not set.")

GEMINI_MODEL_NAME = "gemini-2.0-flash-lite" # As requested

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
You are a meticulous NLP and Knowledge Graph analyst. Your task is to process a given news article and extract structured information.

You must follow these instructions exactly:
1.  You will be given an input JSON object containing a news article.
2.  You must *only* use the text in the `content.article_body` field to perform your tasks. Do not use the title or other metadata.
3.  Your output *must* be a single, valid JSON object containing *only* the keys `summary`, `keywords`, and `entities`.
4.  **For `summary`:** Generate a 2-3 sentence, high-level summary of the event.
5.  **For `keywords`:** Generate an array of 5-7 significant keywords from the text.
6.  **For `entities`:** This is the most important task.
    * Identify all named entities in the text.
    * Classify them as `PERSON`, `ORGANIZATION`, or `LOCATION`.
    * For each entity, find its corresponding WikiData ID (e.g., "Islamabad" is "Q1166").
    * If a WikiData ID is ambiguous or cannot be found, use "null".
    * The output must be an array of JSON objects, each with "text", "label", and "wikidata_id".
"""

USER_PROMPT_TEMPLATE = """
Here is the article to process:

{article_json}
"""

def get_model_response(article_json_str: str) -> dict | None:
    """
    Sends the article body to the Google Gemini model and returns the parsed JSON response.
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

    try:
        logging.info(f"Sending request to Google Gemini model for processing...")
        response = model.generate_content(user_prompt)
        
        # The response text should be a valid JSON string
        response_text = response.text
        parsed_content = json.loads(response_text)
        
        logging.info("Successfully received and parsed response from model.")
        return parsed_content

    except Exception as e:
        logging.error(f"API request or processing failed: {e}")
        # Log the response parts if available for debugging
        if 'response' in locals() and hasattr(response, 'prompt_feedback'):
            logging.error(f"Prompt Feedback: {response.prompt_feedback}")
        if 'response' in locals() and hasattr(response, 'candidates'):
             logging.error(f"Candidates: {response.candidates}")
        
    return None


def process_article_file(input_path: Path, output_path: Path):
    """
    Reads an article, enriches it using the Gemini model, and saves the new version.
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
            data["content"]["summary"] = enriched_data.get("summary", "")
            data["content"]["keywords"] = enriched_data.get("keywords", [])
            data["entities"] = enriched_data.get("entities", {"people": [], "organizations": [], "locations": []})
            
            # Ensure output directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logging.info(f"Successfully enriched and saved {output_path.name}")
        else:
            logging.error(f"Failed to get enrichment data for {input_path.name}.")

    except json.JSONDecodeError:
        logging.error(f"Skipping corrupted JSON file: {input_path}")
    except Exception as e:
        logging.error(f"An unexpected error occurred while processing {input_path.name}: {e}")


def main():
    """
    Main function to walk through directories and process files.
    """
    logging.info("Starting data enrichment process with Google Gemini...")

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

        for input_file, output_file in files_to_process:
            logging.info(f"--- Processing {input_file.name} ---")
            process_article_file(input_file, output_file)
            # Add a small delay to avoid hitting API rate limits
            time.sleep(1) 

    logging.info("Data enrichment process finished.")


if __name__ == "__main__":
    main()


# Logging
LOG_DIR = Path("./logs")
# ... existing code ...
)

# --- Prompt Template ---
SYSTEM_PROMPT = """
You are a meticulous NLP and Knowledge Graph analyst. Your task is to process a given news article and extract structured information.

You must follow these instructions exactly:
1.  You will be given an input JSON object containing a news article.
2.  You must *only* use the text in the `content.article_body` field to perform your tasks. Do not use the title or other metadata.
3.  Your output *must* be a single, valid JSON object containing *only* the keys `summary`, `keywords`, and `entities`.
4.  **For `summary`:** Generate a 2-3 sentence, high-level summary of the event.
5.  **For `keywords`:** Generate an array of 5-7 significant keywords from the text.
6.  **For `entities`:** This is the most important task.
    * Identify all named entities in the text.
    * Classify them as `PERSON`, `ORGANIZATION`, or `LOCATION`.
    * For each entity, find its corresponding WikiData ID (e.g., "Islamabad" is "Q1166").
    * If a WikiData ID is ambiguous or cannot be found, use "null".
    * The output must be an array of JSON objects, each with "text", "label", and "wikidata_id".
"""

USER_PROMPT_TEMPLATE = """
Here is the article to process:

{article_json}
"""

def get_model_response(article_json_str: str) -> dict | None:
    """
    Sends the article body to the Llama model and returns the parsed JSON response.
    """
    user_prompt = USER_PROMPT_TEMPLATE.format(article_json=article_json_str)
    
    payload = {
        "model": LLAMA_MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1,
        "format": "json" # Use 'format' for Ollama's JSON mode
    }
    headers = {"Content-Type": "application/json"}

    try:
        logging.info(f"Sending request to Ollama model for processing...")
        # Ollama streams responses by default, so we disable it for a single response
        response = requests.post(LLAMA_API_URL, json=payload, headers=headers, timeout=300, stream=False)
        response.raise_for_status()
        
        model_output = response.json()
        message_content = model_output.get("message", {}).get("content", "{}")
        
        # Parse the JSON string from the model's content
        parsed_content = json.loads(message_content)
        logging.info("Successfully received and parsed response from model.")
        return parsed_content

    except requests.exceptions.RequestException as e:
        logging.error(f"API request failed: {e}")
    except json.JSONDecodeError as e:
        logging.error(f"Failed to decode JSON from model response: {e}")
        logging.error(f"Raw model response content: {message_content}")
    except (IndexError, KeyError) as e:
        logging.error(f"Unexpected API response structure: {e}")
        logging.error(f"Raw API response: {model_output}")
        
    return None


def process_article_file(input_path: Path, output_path: Path):
    """
    Reads an article, enriches it using the Llama model, and saves the new version.
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
            logging.info(f"Successfully enriched and saved {output_path.name}")
        else:
            logging.error(f"Failed to get enrichment data for {input_path.name}.")

    except json.JSONDecodeError:
        logging.error(f"Skipping corrupted JSON file: {input_path}")
    except Exception as e:
        logging.error(f"An unexpected error occurred while processing {input_path.name}: {e}")


def main():
    """
    Main function to walk through directories and process files.
    """
    logging.info("Starting data enrichment process...")
    
    # Wait for the Llama model to be available
    max_retries = 10
    health_check_url = LLAMA_API_URL.replace("/v1/chat/completions", "/") # Base URL for Ollama
    for i in range(max_retries):
        try:
            response = requests.get(health_check_url, timeout=10)
            if response.status_code == 200 and "Ollama is running" in response.text:
                logging.info("Ollama service is healthy and available.")
                break
        except requests.ConnectionError:
            logging.info(f"Waiting for Ollama service to be available... (Attempt {i+1}/{max_retries})")
            time.sleep(15)
    else:
        logging.error("Could not connect to Ollama service after several attempts. Exiting.")
        return

    for source in SOURCES:
        input_dir = INPUT_BASE_DIR / source / INPUT_SUBDIR
        output_dir = OUTPUT_BASE_DIR / source / OUTPUT_SUBDIR

        if not input_dir.is_dir():
            logging.warning(f"Input directory not found, skipping: {input_dir}")
            continue

        logging.info(f"Processing source: {source}")

        # Get list of files to process (delta check)
        # Using sorted lists to ensure deterministic processing order
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

        for input_file, output_file in files_to_process:
            logging.info(f"--- Processing {input_file.name} ---")
            process_article_file(input_file, output_file)

    logging.info("Data enrichment process finished.")


if __name__ == "__main__":
    main()
