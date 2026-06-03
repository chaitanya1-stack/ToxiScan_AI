# Use a lightweight Python base image
FROM python:3.10-slim

# Hugging Face requires running as a non-root user for security
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

# Set the working directory
WORKDIR /app

# Copy your app files into the container and give the user read/write access
# (This is crucial so your app can auto-build the db_fps.bin file on the hard drive)
COPY --chown=user . /app

# Install the ultra-light requirements
RUN pip install --no-cache-dir -r requirements.txt

# Hugging Face Spaces routes web traffic to port 7860 by default
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]