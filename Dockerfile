FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Install dependencies early to leverage Docker cache
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/

# Expose API port
EXPOSE 8000

# Default command runs the API.  The worker service will override this
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]