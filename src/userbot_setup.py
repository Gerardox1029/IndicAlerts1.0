import os
import asyncio
from telethon import TelegramClient
from dotenv import load_dotenv

# Load env from root
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(env_path):
    load_dotenv(env_path)
else:
    load_dotenv('.env')

API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
SESSION_NAME = 'sesion_personal'
SESSION_PATH = os.path.join(os.path.dirname(__file__), SESSION_NAME)

async def setup():
    print("--- Configuración de Userbot Ditox ---")
    if not API_ID or not API_HASH:
        print(f"Error: TELEGRAM_API_ID o TELEGRAM_API_HASH no encontrados en {os.path.abspath(env_path)}")
        return

    print(f"Usando API_ID: {API_ID}")
    client = TelegramClient(SESSION_PATH, API_ID, API_HASH)
    await client.start()
    
    if await client.is_user_authorized():
        me = await client.get_me()
        print(f"✅ Sesión iniciada con éxito como: {me.first_name} (@{me.username})")
    else:
        print("❌ No se pudo autorizar la sesión.")
    
    await client.disconnect()

if __name__ == '__main__':
    asyncio.run(setup())
