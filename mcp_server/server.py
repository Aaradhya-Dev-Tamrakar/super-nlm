import logging
import sys
from contextlib import asynccontextmanager

from mcp.server.mcpserver import MCPServer

from mcp_server.tools import register_tools

# Configure logging to stderr to prevent corrupting stdio JSON-RPC communication
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr
)
logger = logging.getLogger("super_nlm.mcp")

@asynccontextmanager
async def scheduler_lifespan(server):
    """Clean up a worker explicitly started through MCP on transport shutdown."""
    try:
        yield {}
    finally:
        from backend.batch_downloads import downloads
        from backend.scheduler import scheduler
        await downloads.shutdown()
        if scheduler.running:
            await scheduler.stop()
        elif scheduler._lease:
            scheduler._lease.release()

def create_server() -> MCPServer:
    """Instantiates and configures the Super-NLM MCP Server."""
    server = MCPServer(
        name="super-nlm",
        version="0.1.0",
        lifespan=scheduler_lifespan,
        instructions=(
            "Super-NLM MCP Server with round-robin multi-account rotation. "
            "Distributes notebook queries across all configured Google accounts to prevent "
            "quota exhaustion when multiple parallel agents interact with NotebookLM notebooks. "
            "Supports automatic auto-sharing and rate-limit cooldown fallbacks."
        )
    )
    register_tools(server)
    from mcp_server.fleet_tools import register_fleet_tools
    register_fleet_tools(server)
    return server

def main():
    """Main entry point for stdio execution."""
    logger.info("Starting Super-NLM MCP Server (stdio transport)...")
    server = create_server()
    server.run(transport="stdio")

if __name__ == "__main__":
    main()
