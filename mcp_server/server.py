import sys
import os
import logging
from mcp.server.mcpserver import MCPServer
from mcp_server.tools import register_tools

# Configure logging to stderr to prevent corrupting stdio JSON-RPC communication
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr
)
logger = logging.getLogger("super_nlm.mcp")

def create_server() -> MCPServer:
    """Instantiates and configures the Super-NLM MCP Server."""
    server = MCPServer(
        name="super-nlm",
        version="0.1.0",
        instructions=(
            "Super-NLM MCP Server with round-robin multi-account rotation. "
            "Distributes notebook queries across all configured Google accounts to prevent "
            "quota exhaustion when multiple parallel agents interact with NotebookLM notebooks. "
            "Supports automatic auto-sharing and rate-limit cooldown fallbacks."
        )
    )
    register_tools(server)
    return server

def main():
    """Main entry point for stdio execution."""
    logger.info("Starting Super-NLM MCP Server (stdio transport)...")
    server = create_server()
    server.run(transport="stdio")

if __name__ == "__main__":
    main()
