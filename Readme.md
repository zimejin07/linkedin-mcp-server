# LinkedIn MCP Server

## Description

A server to automate LinkedIn job searches with anti-detection features and persistent sessions.

## Key Features

- ✅ **Anti-detection**: Uses puppeteer-extra with stealth plugin to avoid bot detection.
- ✅ **Session persistence**: Saves cookies so you only need to log in once.
- ✅ **Headless mode**: Runs invisibly in the background.
- ✅ **Human-like behavior**: Random delays, realistic typing speed.
- ✅ **Security checkpoints**: Handles LinkedIn's verification challenges.
- ✅ **Persistent browser profile**: Maintains login state across runs.
- ✅ **Job search with filters**: Filters by time posted, experience level, remote options.
- ✅ **Detailed job info**: Fetches full job descriptions.

## Installation

```bash
# 1. Create project directory
mkdir linkedin-mcp-server
cd linkedin-mcp-server

# 2. Save the code as index.js and package.json

# 3. Install dependencies
npm install

# 4. Make it executable
chmod +x index.js

# 5. Set environment variables (secure way)
export LINKEDIN_EMAIL="your-email@example.com"
export LINKEDIN_PASSWORD="your-password"
```

## Claude Desktop Configuration

Edit your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/full/path/to/linkedin-mcp-server/index.js"],
      "env": {
        "LINKEDIN_EMAIL": "your-email@example.com",
        "LINKEDIN_PASSWORD": "your-password"
      }
    }
  }
}
```

Restart Claude Desktop.

## Usage Examples

Once configured, you can prompt Claude:

- **"Log into LinkedIn and search for Python developer jobs in New York posted in the last 24 hours."**
- **"Find remote software engineering jobs at the mid-senior level."**
- **"Get the details of this job: [LinkedIn job URL]."**

Claude will automatically use the MCP tools to execute your requests.

## Concerns Handled

- **Bot Detection**: Stealth plugin + realistic user agent.
- **Rate Limiting**: Random delays between actions.
- **Session Management**: Saves cookies, maintains browser profile.
- **Security Checkpoints**: Detects and alerts for manual verification.
- **Credential Security**: Uses environment variables.
- **Headless Mode**: Runs without a visible browser.
- **Error Handling**: Graceful failures with informative messages.
- **Resource Cleanup**: Proper browser closure.

## First Time Setup

The first time you run this, LinkedIn may require verification (email/SMS). If this happens:

1. The server will notify you.
2. Set `headless: false` in the code temporarily.
3. Complete verification manually.
4. Session will be saved for future automated use.