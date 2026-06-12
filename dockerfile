# 1. Start with the slim image
FROM python:3.10-slim

# 2. Install system dependencies required by RDKit
# We must do this as root before switching to the 'user'
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxrender1 \
    libxext6 \
    libx11-6 \
    libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# 3. Security: Hugging Face requirement
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

# 4. Set workdir
WORKDIR /app

# 5. Copy requirements FIRST to leverage Docker cache
# (This makes builds much faster when you change your code)
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# 6. Copy the rest of your app
COPY --chown=user . /app

# 7. Expose the port
EXPOSE 7860

# 8. Start the app
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
