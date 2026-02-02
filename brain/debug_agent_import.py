import sys
import os
import asyncio
import traceback

# Add current directory to path so we can import src
sys.path.append(os.getcwd())

print("Attempting to import chat_agent...")
try:
    from src.agents.chat_agent import run_chat_agent
    print("SUCCESS: chat_agent imported correctly.")
except Exception as e:
    print("FAILURE: Could not import chat_agent.")
    traceback.print_exc()
    sys.exit(1)

async def test_run():
    print("Attempting to run chat agent...")
    try:
        # Dummy UUID
        user_id = "962ef73a-a370-41a4-9adf-5a2ed5cf35f5" # Use the user's ID from the log
        resp = await run_chat_agent(user_id, "test_conv", "How is my recovery?")
        print("SUCCESS: Agent ran without error!")
        print(resp)
    except Exception as e:
        print("FAILURE: Runtime error during execution.")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_run())
