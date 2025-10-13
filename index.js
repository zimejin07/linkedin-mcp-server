#!/usr/bin/env node
import "dotenv/config";

/**
 * LinkedIn Automation MCP Server
 * Handles login, job searches, and profile viewing with anti-detection measures
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const CONFIG = {
  userDataDir: path.join(__dirname, ".linkedin-browser-data"),
  cookiesPath: path.join(__dirname, ".linkedin-cookies.json"),
  headless: false, // Set to false for debugging
  slowMo: 100, // Slow down operations to appear more human
};

class LinkedInAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
  }

  async initialize() {
    if (this.browser) return;

    // Ensure user data directory exists
    if (!existsSync(CONFIG.userDataDir)) {
      await mkdir(CONFIG.userDataDir, { recursive: true });
    }

    this.browser = await puppeteer.launch({
      headless: CONFIG.headless,
      slowMo: CONFIG.slowMo,
      userDataDir: CONFIG.userDataDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--window-size=1920,1080",
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
    });

    this.page = await this.browser.newPage();

    // Set realistic headers
    await this.page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await this.page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    });

    // Load saved cookies if they exist
    await this.loadCookies();

    // Random delay helper
    this.randomDelay = (min = 1000, max = 3000) =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.random() * (max - min) + min)
      );
  }

  async loadCookies() {
    try {
      if (existsSync(CONFIG.cookiesPath)) {
        const cookies = JSON.parse(await readFile(CONFIG.cookiesPath, "utf-8"));
        await this.page.setCookie(...cookies);
        console.error("Loaded saved cookies");
      }
    } catch (error) {
      console.error("Failed to load cookies:", error.message);
    }
  }

  async saveCookies() {
    try {
      const cookies = await this.page.cookies();
      await writeFile(CONFIG.cookiesPath, JSON.stringify(cookies, null, 2));
      console.error("Saved cookies");
    } catch (error) {
      console.error("Failed to save cookies:", error.message);
    }
  }

  async login(email, password) {
    try {
      await this.initialize();

      // Check if already logged in
      await this.page.goto("https://www.linkedin.com/feed/", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // If we're on the feed page, we're already logged in
      if (this.page.url().includes("/feed/")) {
        this.isLoggedIn = true;
        return {
          success: true,
          message: "Already logged in (session restored)",
        };
      }

      // Navigate to login page
      await this.page.goto("https://www.linkedin.com/login", {
        waitUntil: "networkidle2",
      });

      await this.randomDelay(500, 1500);

      // Type email with human-like delays
      await this.page.waitForSelector("#username", { timeout: 10000 });
      await this.page.type("#username", email, { delay: 120 });
      await this.randomDelay(300, 800);

      // Type password
      await this.page.type("#password", password, { delay: 130 });
      await this.randomDelay(500, 1000);

      // Click login button
      await this.page.click('button[type="submit"]');

      // Wait for navigation
      await this.page
        .waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 30000,
        })
        .catch(() => {});

      await this.randomDelay(2000, 3000);

      // Check for verification/checkpoint
      const currentUrl = this.page.url();

      if (
        currentUrl.includes("checkpoint") ||
        currentUrl.includes("challenge")
      ) {
        return {
          success: false,
          message:
            "Security checkpoint detected. LinkedIn requires manual verification. Please log in manually once, then the session will be saved.",
          needsManualVerification: true,
        };
      }

      // Verify login success
      if (currentUrl.includes("/feed/") || currentUrl.includes("/mynetwork/")) {
        this.isLoggedIn = true;
        await this.saveCookies();
        return { success: true, message: "Login successful" };
      }

      // Check for error messages
      const errorElement = await this.page.$("#error-for-password");
      if (errorElement) {
        const errorText = await this.page.evaluate(
          (el) => el.textContent,
          errorElement
        );
        return { success: false, message: `Login failed: ${errorText}` };
      }

      return { success: false, message: "Login failed: Unknown error" };
    } catch (error) {
      return { success: false, message: `Login error: ${error.message}` };
    }
  }

  async searchJobs(keywords, location = "", filters = {}) {
    try {
      if (!this.isLoggedIn) {
        return {
          success: false,
          message: "Not logged in. Please log in first.",
        };
      }

      // Build search URL
      let searchUrl = "https://www.linkedin.com/jobs/search/?";
      const params = new URLSearchParams();

      params.append("keywords", keywords);
      if (location) params.append("location", location);
      if (filters.timePosted) params.append("f_TPR", filters.timePosted); // r86400 (24h), r604800 (week)
      if (filters.experienceLevel)
        params.append("f_E", filters.experienceLevel); // 1,2,3,4,5,6
      if (filters.remote) params.append("f_WT", "2"); // Remote jobs

      searchUrl += params.toString();

      await this.page.goto(searchUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await this.randomDelay(2000, 3000);

      // Wait for results
      await this.page.waitForSelector(".jobs-search__results-list", {
        timeout: 15000,
      });

      await this.randomDelay(1000, 2000);

      // Scroll to load more results
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });

      await this.randomDelay(1000, 2000);

      // Extract job listings
      const jobs = await this.page.evaluate(() => {
        const jobCards = document.querySelectorAll(
          ".job-card-container, .jobs-search-results__list-item"
        );
        const results = [];

        jobCards.forEach((card) => {
          try {
            const titleEl = card.querySelector(
              ".job-card-list__title, .job-card-container__link"
            );
            const companyEl = card.querySelector(
              ".job-card-container__primary-description, .job-card-container__company-name"
            );
            const locationEl = card.querySelector(
              ".job-card-container__metadata-item"
            );
            const linkEl = card.querySelector(
              "a.job-card-list__title, a.job-card-container__link"
            );
            const timeEl = card.querySelector("time");

            if (titleEl) {
              results.push({
                title: titleEl.textContent.trim(),
                company: companyEl ? companyEl.textContent.trim() : "N/A",
                location: locationEl ? locationEl.textContent.trim() : "N/A",
                link: linkEl ? linkEl.href : "N/A",
                postedTime: timeEl ? timeEl.getAttribute("datetime") : "N/A",
              });
            }
          } catch (e) {
            console.error("Error parsing job card:", e);
          }
        });

        return results;
      });

      return {
        success: true,
        jobs: jobs.slice(0, 25), // Return top 25 results
        searchUrl,
        totalFound: jobs.length,
      };
    } catch (error) {
      return {
        success: false,
        message: `Job search error: ${error.message}`,
      };
    }
  }

  async getJobDetails(jobUrl) {
    try {
      await this.page.goto(jobUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await this.randomDelay(1500, 2500);

      const details = await this.page.evaluate(() => {
        const getTextContent = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : "N/A";
        };

        return {
          title: getTextContent(
            ".job-details-jobs-unified-top-card__job-title"
          ),
          company: getTextContent(
            ".job-details-jobs-unified-top-card__company-name"
          ),
          location: getTextContent(
            ".job-details-jobs-unified-top-card__bullet"
          ),
          description: getTextContent(".jobs-description__content"),
          seniority: getTextContent(
            ".job-details-jobs-unified-top-card__job-insight:nth-of-type(1)"
          ),
          employmentType: getTextContent(
            ".job-details-jobs-unified-top-card__job-insight:nth-of-type(2)"
          ),
        };
      });

      return { success: true, details };
    } catch (error) {
      return {
        success: false,
        message: `Error getting job details: ${error.message}`,
      };
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
    }
  }
}

// MCP Server Setup
const automation = new LinkedInAutomation();

const server = new Server(
  {
    name: "linkedin-automation",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "linkedin_login",
        description:
          "Log into LinkedIn. Credentials should be provided via environment variables LINKEDIN_EMAIL and LINKEDIN_PASSWORD for security. Saves session for future use.",
        inputSchema: {
          type: "object",
          properties: {
            email: {
              type: "string",
              description: "LinkedIn email (optional if using env vars)",
            },
            password: {
              type: "string",
              description: "LinkedIn password (optional if using env vars)",
            },
          },
        },
      },
      {
        name: "linkedin_search_jobs",
        description:
          "Search for jobs on LinkedIn. Must be logged in first. Returns top 25 results with title, company, location, and link.",
        inputSchema: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description: "Job search keywords (e.g., 'software engineer')",
            },
            location: {
              type: "string",
              description: "Job location (e.g., 'San Francisco, CA')",
            },
            filters: {
              type: "object",
              description: "Optional filters",
              properties: {
                timePosted: {
                  type: "string",
                  description: "r86400 (24h), r604800 (week), r2592000 (month)",
                },
                experienceLevel: {
                  type: "string",
                  description:
                    "1 (Internship), 2 (Entry), 3 (Associate), 4 (Mid-Senior), 5 (Director), 6 (Executive)",
                },
                remote: {
                  type: "boolean",
                  description: "Filter for remote jobs only",
                },
              },
            },
          },
          required: ["keywords"],
        },
      },
      {
        name: "linkedin_get_job_details",
        description:
          "Get detailed information about a specific job posting from its URL.",
        inputSchema: {
          type: "object",
          properties: {
            jobUrl: {
              type: "string",
              description: "Full LinkedIn job posting URL",
            },
          },
          required: ["jobUrl"],
        },
      },
      {
        name: "linkedin_cleanup",
        description:
          "Close browser and cleanup resources. Call when done with LinkedIn tasks.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "linkedin_login": {
        const email = args.email || process.env.LINKEDIN_EMAIL;
        const password = args.password || process.env.LINKEDIN_PASSWORD;

        if (!email || !password) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  message:
                    "Email and password required. Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD environment variables or pass them as arguments.",
                }),
              },
            ],
          };
        }

        const result = await automation.login(email, password);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "linkedin_search_jobs": {
        const result = await automation.searchJobs(
          args.keywords,
          args.location,
          args.filters || {}
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "linkedin_get_job_details": {
        const result = await automation.getJobDetails(args.jobUrl);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "linkedin_cleanup": {
        await automation.cleanup();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Cleanup complete",
              }),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "Unknown tool" }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message }),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LinkedIn MCP Server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
