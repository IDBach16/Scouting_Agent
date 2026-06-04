"""
Gunicorn config — auto-loaded from ./gunicorn.conf.py (the app runs from /app),
regardless of how gunicorn is started. Railway was launching a bare
`gunicorn server:app` with stock defaults (sync worker, 1 worker, 30s timeout),
ignoring the Procfile flags — so any /api/chat full-analysis request that ran
longer than 30s was killed mid-call ("WORKER TIMEOUT"). Putting the settings
here makes them apply even with a flag-less start command.
"""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
worker_class = "gthread"   # threads => handle concurrent requests / retries
workers = 2
threads = 4
timeout = 300              # full-analysis calls can exceed 30s; the Anthropic SDK
                           # times out at 180s first and returns a clean 504
graceful_timeout = 30
keepalive = 5
