import asyncio
from mcp_client import client

async def inspect_tool():
    tools = await client.get_tools()

    for tool in tools:
        if tool.name == "flight_arrival_departure_schedule":
            print("NAME:", tool.name)
            
            print("ARGS SCHEMA:", tool.args)

asyncio.run(inspect_tool())