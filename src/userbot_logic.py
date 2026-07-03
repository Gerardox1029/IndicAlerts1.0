import sys
import json
import asyncio
import os
from telethon import TelegramClient
from dotenv import load_dotenv

# Load env from root
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(env_path):
    load_dotenv(env_path)
else:
    # Try current directory as fallback
    load_dotenv('.env')

API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')

if not API_ID or not API_HASH:
    print(json.dumps({"success": False, "error": "MISSING_ENV", "message": f"TELEGRAM_API_ID o API_HASH no encontrados en {os.path.abspath(env_path)}"}))
    sys.exit(1)

SESSION_NAME = 'sesion_personal'
SESSION_PATH = os.path.join(os.path.dirname(__file__), SESSION_NAME)

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No arguments provided"}))
        return

    try:
        arg = sys.argv[1]
        if arg.startswith('@'):
            with open(arg[1:], 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = json.loads(arg)
        
        message = data.get('message', '')
        image_base64 = data.get('image_base64') # We might save this to a temp file
        groups = data.get('groups', [])
        
        client = TelegramClient(SESSION_PATH, API_ID, API_HASH)
        await client.connect()

        if not await client.is_user_authorized():
            print(json.dumps({"success": False, "error": "NOT_AUTHORIZED", "message": "Userbot not authorized. Run setup script first."}))
            return

        temp_image = None
        if image_base64:
            import base64
            import tempfile
            # data:image/png;base64,...
            if ',' in image_base64:
                header, encoded = image_base64.split(',', 1)
            else:
                encoded = image_base64
            
            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp:
                tmp.write(base64.b64decode(encoded))
                temp_image = tmp.name

        import random
        results = []
        for idx, chat_id in enumerate(groups):
            try:
                # Telethon handles @usernames and -IDs
                target = chat_id
                if str(chat_id).isdigit() or (str(chat_id).startswith('-') and str(chat_id)[1:].isdigit()):
                    target = int(chat_id)
                
                if temp_image:
                    await client.send_file(target, temp_image, caption=message, parse_mode='html')
                else:
                    await client.send_message(target, message, parse_mode='html')
                results.append({"group": chat_id, "success": True})
            except Exception as e:
                results.append({"group": chat_id, "success": False, "error": str(e)})

            if idx < len(groups) - 1:
                delay = random.randint(3, 15)
                await asyncio.sleep(delay)

        if temp_image and os.path.exists(temp_image):
            os.remove(temp_image)

        await client.disconnect()
        print(json.dumps({"success": True, "results": results}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == '__main__':
    asyncio.run(main())
