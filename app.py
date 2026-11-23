import subprocess
import threading
import os
import sys

def run_bot():
    print("🚀 Initializing Flatzy Telegram Admin Bot on Hugging Face...")
    # Install dependencies if needed
    if not os.path.exists("node_modules"):
        print("📦 Installing npm dependencies...")
        subprocess.run(["npm", "install", "--production"], check=True)
    
    # Run the Node bot
    print("⚡ Launching bot.js...")
    subprocess.run(["node", "bot.js"])

# Start Node process in background
t = threading.Thread(target=run_bot, daemon=True)
t.start()

# Gradio interface to keep the Space alive 24/7
import gradio as gr

def status():
    return "🟢 Flatzy Telegram Admin Bot is running 24/7 on Hugging Face!\nUse /rooms or /start in Telegram."

with gr.Blocks(title="Flatzy Admin Bot") as demo:
    gr.Markdown("# 🏢 Flatzy Telegram Admin Bot (24/7 Active)")
    gr.Markdown("This Hugging Face Space powers the automated `@flatzyadminbot` for Flatzy Kolkata.")
    box = gr.Textbox(value=status, label="Service Health", interactive=False)
    btn = gr.Button("Refresh Status")
    btn.click(fn=status, outputs=box)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
