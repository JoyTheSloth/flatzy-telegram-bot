import subprocess
import threading
import time
import os
import gradio as gr

def run_node_bot():
    print("🚀 Starting Flatzy Telegram Bot on Node.js...")
    # Install dependencies if node_modules not present
    if not os.path.exists("node_modules"):
        print("📦 Installing npm packages...")
        subprocess.run(["npm", "install"], check=True)
    
    # Run bot
    process = subprocess.Popen(["node", "bot.js"])
    process.wait()

# Start bot in a background thread
bot_thread = threading.Thread(target=run_node_bot, daemon=True)
bot_thread.start()

def get_status():
    return "🟢 Flatzy Telegram Admin Bot is running 24/7!\n\nSend /rooms or /list in Telegram to manage listings."

with gr.Blocks(title="Flatzy Telegram Admin Bot") as demo:
    gr.Markdown("# 🏢 Flatzy Telegram Admin Bot Service")
    gr.Markdown("This Hugging Face Space hosts the Flatzy Telegram Admin Bot 24/7.")
    status_box = gr.Textbox(value=get_status, label="Bot Status", interactive=False)
    btn = gr.Button("Refresh Status")
    btn.click(fn=get_status, outputs=status_box)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)

