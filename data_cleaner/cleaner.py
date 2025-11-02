import shutil
import argparse
import json
import re
import math
from pathlib import Path
import sys
import unicodedata
import codecs

# Characters that are invisible or formatting controls commonly leaking from web copy
# We strip these to avoid artifacts like "PakisSHYtan" (U+00AD soft hyphen embedded in words).
# The list intentionally includes various zero-widths, directional marks, and deprecated
# invisibles that often sneak into scraped text.
_INVISIBLE_CODEPOINTS = [
    "\u00AD",  # SOFT HYPHEN (SHY)
    "\u200B",  # ZERO WIDTH SPACE
    "\u200C",  # ZERO WIDTH NON-JOINER
    "\u200D",  # ZERO WIDTH JOINER
    "\u2060",  # WORD JOINER
    "\uFEFF",  # ZERO WIDTH NO-BREAK SPACE (BOM)
    "\u2028",  # LINE SEPARATOR
    "\u2029",  # PARAGRAPH SEPARATOR
    "\u034F",  # COMBINING GRAPHEME JOINER
    "\u180E",  # MONGOLIAN VOWEL SEPARATOR (deprecated; treated as zero width)
    # Directional and invisible formatting characters
    "\u200E",  # LEFT-TO-RIGHT MARK
    "\u200F",  # RIGHT-TO-LEFT MARK
    "\u202A", "\u202B", "\u202C", "\u202D", "\u202E",  # embedding/override marks
    "\u2066", "\u2067", "\u2068", "\u2069",  # LRI, RLI, FSI, PDI
    # Invisible operators/separators occasionally appearing from PDFs
    "\u2061", "\u2062", "\u2063", "\u2064",
]

# Build a translate deletion map for speed
_INVISIBLE_DELETE_MAP = {ord(ch): None for ch in _INVISIBLE_CODEPOINTS}

# Characters we want to normalize (map) rather than delete
_TRANSLATE_MAP = {
    ord("\u00A0"): " ",   # NO-BREAK SPACE → regular space
}

# Precompiled regex patterns for cleaning
_RE_HTML_SHY = re.compile(r"(?:&shy;|&#173;)", flags=re.IGNORECASE)
_RE_LITERAL_SHY_INNER = re.compile(r"(?i)(?<=\w)shy(?=\w)")
_RE_INTRAWORD_HYPHENS = re.compile(r"(?<=\w)[\u00AD\u2010\u2011](?=\w)")
_RE_GOOGLE_ADS = re.compile(r"\(adsbygoogle=window\.adsbygoogle\|\|\[\]\)\.push\(\{\}\);")
_RE_NEWLINES_TABS = re.compile(r"[\n\t]+")
_RE_WHITESPACE = re.compile(r"\s+")


def normalize_invisible_chars(text: str) -> str:
    """
    Remove zero-width/invisible formatting characters and normalize Unicode.

    - Deletes specific code points known to appear in scraped text (e.g., U+00AD SHY).
    - Converts NBSP (U+00A0) to a normal space.
    - Applies NFKC normalization to fold compatibility characters.
    - Returns the input unchanged if it's not a string.
    """
    if not isinstance(text, str):
        return ""
    # Fast path: delete listed invisibles
    text = text.translate(_INVISIBLE_DELETE_MAP)
    # Normalize certain spacing characters
    text = text.translate(_TRANSLATE_MAP)
    # Normalize general presentation forms
    text = unicodedata.normalize("NFKC", text)
    return text


def clean_text(text):
    """
    A more advanced text cleaning function.
    - Removes the (adsbygoogle=window.adsbygoogle||[]).push({}); snippet.
    - Removes invisible/formatting characters (e.g., U+00AD soft hyphen) and normalizes Unicode.
    - Replaces HTML soft hyphen entities (&shy; and &#173;) if present.
    - Replaces multiple newlines with a single space.
    - Removes extra whitespace and trims.
    """
    if not isinstance(text, str):
        return ""

    # 0. Unescape characters (e.g., convert '\\"' to '"')
    # This is a safe operation that standardizes escape sequences.
    text = codecs.decode(text, 'unicode_escape')

    # -1. Replace HTML entity forms of soft hyphen (common in scraped HTML)
    text = text.replace("&shy;", "").replace("&#173;", "")

    # -0.5 Handle cases where soft hyphen leaked as literal letters "SHY" inside words
    # Some scrapers mistakenly decode `&shy;` to the text "SHY". Remove only when it's in the middle of a word.
    text = re.sub(r'(?i)(?<=\w)shy(?=\w)', '', text)

    # 0. Remove invisible formatting characters and normalize Unicode
    text = normalize_invisible_chars(text)

    # 0.1 Remove discretionary/nb hyphens that appear inside words (keep real hyphens in compounds)
    # Removes U+00AD (soft hyphen), U+2010 (hyphen), U+2011 (non‑breaking hyphen) only when between word chars
    text = re.sub(r'(?<=\w)[\u00AD\u2010\u2011](?=\w)', '', text)
    
    # 1. Remove Google Ads snippet
    text = re.sub(r'\(adsbygoogle=window\.adsbygoogle\|\|\[\]\)\.push\({}\);', '', text)
    
    # 2. Replace newlines and tabs with a space
    text = re.sub(r'[\n\t]+', ' ', text)
    
    # 3. Remove extra whitespace and trim
    cleaned_text = re.sub(r'\s+', ' ', text).strip()
    return cleaned_text

def to_ascii_text(text: str) -> str:
    """
    Convert text to an ASCII-safe representation while preserving readability:
    - Runs through `normalize_invisible_chars` first to drop zero-widths and normalize.
    - Maps common smart punctuation to plain ASCII equivalents.
    - Uses NFKD + ASCII encoding to strip remaining non-ASCII (diacritics, symbols).
    - Collapses whitespace.
    """
    if not isinstance(text, str):
        return ""

    # Normalize invisibles and spacing first
    text = normalize_invisible_chars(text)

    # Map common typographic punctuation to ASCII
    smart_map = {
        "\u2018": "'",  # left single quote
        "\u2019": "'",  # right single quote / apostrophe
        "\u201A": "'",  # single low-9 quote
        "\u201B": "'",  # single high-reversed-9 quote
        "\u201C": '"',  # left double quote
        "\u201D": '"',  # right double quote
        "\u201E": '"',  # double low-9 quote
        "\u2026": "...", # ellipsis
        "\u2013": "-",  # en dash
        "\u2014": "-",  # em dash
        "\u2212": "-",  # minus sign
        "\u00B7": "-",  # middle dot → dash
        "\u2022": "-",  # bullet → dash
        "\u00AB": '"',  # «
        "\u00BB": '"',  # »
        "\u00A0": " ",  # NBSP → space
        "\u2010": "-",  # hyphen
        "\u2011": "-",  # non-breaking hyphen
    }
    text = text.translate({ord(k): v for k, v in smart_map.items()})

    # Decompose and strip non-ASCII
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii", "ignore")

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text

def get_reading_time_minutes(word_count, words_per_minute=200):
    """Calculates estimated reading time in minutes."""
    if word_count == 0:
        return 0
    return math.ceil(word_count / words_per_minute)

def _deep_clean(obj):
    """Recursively apply clean_text to all string values inside dicts/lists/tuples."""
    if isinstance(obj, str):
        return clean_text(obj)
    if isinstance(obj, dict):
        return {k: _deep_clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deep_clean(v) for v in obj]
    if isinstance(obj, tuple):
        return tuple(_deep_clean(v) for v in obj)
    return obj


def process_article_file(file_path: Path, base_input_dir: Path, base_output_dir: Path):
    """
    Reads an article JSON, cleans and transforms it into the new,
    enriched structure, and saves it. This function no longer checks for
    the output file's existence, as that logic is now handled in the main loop.
    """
    try:
        # Determine the output path
        relative_path = file_path.relative_to(base_input_dir)
        output_path = base_output_dir / relative_path
        
        # Defensively check for empty files before trying to parse
        if file_path.stat().st_size == 0:
            print(f"⚠️  Skipping empty file: {file_path}")
            return

        with open(file_path, 'r', encoding='utf-8') as f:
            original_data = json.load(f)

        # --- Transformation ---
        
        # 1. Clean the core content (handle both flat and nested schemas)
        raw_content = original_data.get('content')
        if isinstance(raw_content, dict):
            raw_body = raw_content.get('article_body')
        else:
            raw_body = raw_content
        # Clean text (Unicode-preserving), then convert to ASCII-safe for article_body only
        cleaned_body_unicode = clean_text(raw_body)
        cleaned_body = to_ascii_text(cleaned_body_unicode)

        # Title might be nested under metadata in some schemas
        raw_title = original_data.get('title')
        if raw_title is None and isinstance(original_data.get('metadata'), dict):
            raw_title = original_data['metadata'].get('title')
        cleaned_title = clean_text(raw_title)
        
        # 2. Perform simple enrichments
        word_count = len(cleaned_body.split()) if isinstance(cleaned_body, str) else 0
        reading_time = get_reading_time_minutes(word_count)
        
        # 3. Build the new, structured dictionary
        transformed_data = {
            "article_id": file_path.stem, # Use filename as ID
            "source_info": {
                "source_name": (original_data.get('source')
                                  or (original_data.get('source_info') or {}).get('source_name')),
                "source_link": (original_data.get('link')
                                  or (original_data.get('source_info') or {}).get('source_link')),
                "retrieved_at": (original_data.get('retrievedAt')
                                  or (original_data.get('source_info') or {}).get('retrieved_at'))
            },
            "metadata": {
                "title": cleaned_title,
                "author": original_data.get('author') or (original_data.get('metadata') or {}).get('author'),
                "date_published": original_data.get('date_published') or (original_data.get('metadata') or {}).get('date_published'),
                "image_url": original_data.get('image') or (original_data.get('metadata') or {}).get('image_url'),
                "categories": original_data.get('categories') or (original_data.get('metadata') or {}).get('categories', []),
                "word_count": word_count,
                "reading_time_minutes": reading_time
            },
            "content": {
                "article_body": cleaned_body,
                "summary": "", # Placeholder for NLP
                "keywords": [] # Placeholder for NLP
            },
            "entities": {
                "people": [],       # Placeholder for NLP
                "organizations": [],# Placeholder for NLP
                "locations": []     # Placeholder for NLP
            }
        }
        
        # Deep clean all string values before saving
        transformed_data = _deep_clean(transformed_data)
        
        # --- End Transformation ---

        # Ensure the output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write the NEW, transformed data
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(transformed_data, f, indent=2, ensure_ascii=False)
        
        # This print statement is being removed to reduce log noise.
        # A summary will be provided by the main loop.
        # print(f"✅ Transformed and saved: {output_path}")

    except json.JSONDecodeError:
        print(f"❌ Error decoding JSON from: {file_path}")
    except Exception as e:
        print(f"❌ An unexpected error occurred processing {file_path}: {e}")

def main(data_root_dir: str, force_source: str = None):
    """
    Main function to walk through the data directory and process all articles.
    """
    print("🚀 Starting data transformation process...")
    base_path = Path(data_root_dir)
    
    # Determine which sources to process
    if force_source:
        sources_to_process = [force_source]
        print(f"Processing specified source: {force_source}")
    else:
        # Exclude 'progress' directory from the list of sources
        sources_to_process = [d.name for d in base_path.iterdir() if d.is_dir() and d.name != 'progress']
        if not sources_to_process:
            print(f"No source directories found in {data_root_dir}. Exiting.")
            return
        print(f"Found sources: {', '.join(sources_to_process)}")

    for source in sources_to_process:
        articles_dir = base_path / source / 'articles'
        transformed_articles_dir = base_path / source / 'transformed_articles'

        if not articles_dir.is_dir():
            print(f"⚠️  Source '{source}' articles directory not found at '{articles_dir}'. Skipping.")
            continue
            
        if force_source and transformed_articles_dir.exists():
            print(f"🔥 Force option enabled. Deleting existing transformed data for '{source}'...")
            shutil.rmtree(transformed_articles_dir)
            print(f"🗑️  Deleted: {transformed_articles_dir}")

        print(f"\n🔎 Processing source: {source}")
        
        # 1. Get all source file paths
        all_source_files = {p.relative_to(articles_dir): p for p in articles_dir.rglob('*.json')}
        
        # 2. Get all destination file paths
        transformed_articles_dir.mkdir(parents=True, exist_ok=True) # Ensure dir exists
        all_dest_files = {p.relative_to(transformed_articles_dir): p for p in transformed_articles_dir.rglob('*.json')}
        
        # 3. Calculate the difference
        files_to_process_relative = all_source_files.keys() - all_dest_files.keys()
        
        # 4. Get the full paths for the files that need processing
        files_to_process = [all_source_files[rel_path] for rel_path in files_to_process_relative]
        
        total_files = len(files_to_process)
        
        if not files_to_process:
            print("   ✅ No new articles to process. All transformed files are up to date.")
            continue

        print(f"   Found {total_files} new article(s) to process.")

        # Now, loop through the smaller list and process one by one.
        for i, file_path in enumerate(files_to_process):
            # Provide some progress feedback
            print(f"   [{i+1}/{total_files}] Processing: {file_path.name}")
            process_article_file(file_path, articles_dir, transformed_articles_dir)

    print("\n✅ Data transformation process completed.")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Clean and transform article JSON data.")
    parser.add_argument(
        'data_dir',
        nargs='?',
        default='/app/data',
        help="The root directory containing the source data (e.g., /app/data)."
    )
    parser.add_argument(
        '--force',
        metavar='SOURCE_NAME',
        type=str,
        help="Force reprocessing of a specific source (e.g., 'app' or 'dawn') by deleting its existing transformed data."
    )
    
    args = parser.parse_args()
    main(data_root_dir=args.data_dir, force_source=args.force)