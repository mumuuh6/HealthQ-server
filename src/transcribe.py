import whisper
import sys
import json

# Load Whisper model (medium is good balance)
model = whisper.load_model("medium")

# Audio file path from Node.js
file_path = sys.argv[1]

# Transcribe Bangla -> English
result = model.transcribe(file_path, language="bn", task="translate")

# Output JSON for Node.js to parse
print(json.dumps({"transcript": result["text"]}))
