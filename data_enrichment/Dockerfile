# Dockerfile for the Data Enrichment Service

# Use a slim Python base image
FROM python:3.9-slim

# Set the working directory
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the enrichment script into the container
COPY enricher.py .

# Set the entrypoint for the container
# This will run the Python script when the container starts
CMD ["python", "enricher.py"]
