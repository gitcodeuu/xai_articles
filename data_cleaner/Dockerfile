# Dockerfile for the data_cleaner service

# Use an official lightweight Python image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the Python script into the container
COPY cleaner.py .

# The command to run when the container starts
# It will process the data in the mounted '/app/data' volume
CMD ["python", "cleaner.py", "/app/data"]
