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
LLAMA_API_URL = "http://llama-model:8080/v1/chat/completions"
LLAMA_MODEL_NAME = "llama3.2"

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
PROMPT_TEMPLATE = """
Analyze the following news article body to extract a summary, keywords, and named entities.

**Article Body:**
{article_body}

**Instructions:**
Respond with a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON object.
The JSON object must have the following structure:
{{
  "summary": "A concise, one-paragraph summary of the article.",
  "keywords": ["A", "list", "of", "5-7", "key", "terms", "or", "phrases"],
  "entities": {{
    "people": ["List of names of individuals mentioned"],
    "organizations": ["List of organizations, companies, or institutions mentioned"],
    "locations": ["List of cities, countries, or specific places mentioned"]
  }}
}}
"""

def get_model_response(article_body: str) -> dict | None:
    """
    Sends the article body to the Llama model and returns the parsed JSON response.
    """
    prompt = PROMPT_TEMPLATE.format(article_body=article_body)
    payload = {
        "model": LLAMA_MODEL_NAME,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    }
    headers = {"Content-Type": "application/json"}

    try:
        logging.info(f"Sending request to Llama model for processing...")
        response = requests.post(LLAMA_API_URL, json=payload, headers=headers, timeout=300)
        response.raise_for_status()
        
        # The model should return a JSON object directly in the content
        model_output = response.json()
        # The actual content is usually nested
        message_content = model_output.get("choices", [{}])[0].get("message", {}).get("content", "{}")
        
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

        enriched_data = get_model_response(article_body)

        if enriched_data:
            # Update the original JSON data with the new fields
            data["summary"] = enriched_data.get("summary", "")
            data["keywords"] = enriched_data.get("keywords", [])
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
    for i in range(max_retries):
        try:
            response = requests.get(LLAMA_API_URL.replace("/v1/chat/completions", "/health"), timeout=10)
            if response.status_code == 200:
                logging.info("Llama model is healthy and available.")
                break
        except requests.ConnectionError:
            logging.info(f"Waiting for Llama model to be available... (Attempt {i+1}/{max_retries})")
            time.sleep(15)
    else:
        logging.error("Could not connect to Llama model after several attempts. Exiting.")
        return

    for source in SOURCES:
        input_dir = INPUT_BASE_DIR / source / INPUT_SUBDIR
        output_dir = OUTPUT_BASE_DIR / source / OUTPUT_SUBDIR

        if not input_dir.is_dir():
            logging.warning(f"Input directory not found, skipping: {input_dir}")
            continue

        logging.info(f"Processing source: {source}")

        # Get list of files to process (delta check)
        input_files = {f for f in input_dir.glob("**/*.json") if f.is_file()}
        output_files = {output_dir / f.relative_to(input_dir) for f in input_files}
        
        files_to_process = [
            (in_file, out_file) for in_file, out_file in zip(input_files, output_files) if not out_file.exists()
        ]

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
