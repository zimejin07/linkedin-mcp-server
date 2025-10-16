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
  headless: true, // Set to true after first login verification
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

      console.error("Checking if already logged in...");

      // Check if already logged in by trying to access feed
      try {
        await this.page.goto("https://www.linkedin.com/feed/", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        await this.randomDelay(2000, 3000);

        // If we're on the feed page, we're already logged in
        if (this.page.url().includes("/feed/")) {
          this.isLoggedIn = true;
          console.error("Already logged in via saved session");
          return {
            success: true,
            message: "Already logged in (session restored)",
          };
        }
      } catch (e) {
        console.error("Not logged in, proceeding to login page...");
      }

      // Navigate to login page
      console.error("Going to login page...");
      await this.page.goto("https://www.linkedin.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      await this.randomDelay(1000, 2000);

      // Wait for login form
      console.error("Waiting for login form...");
      await this.page.waitForSelector("#username", { timeout: 10000 });

      // Type email with human-like delays
      console.error("Typing email...");
      await this.page.type("#username", email, { delay: 120 });
      await this.randomDelay(300, 800);

      // Type password
      console.error("Typing password...");
      await this.page.type("#password", password, { delay: 130 });
      await this.randomDelay(500, 1000);

      // Click login button
      console.error("Clicking login button...");
      const submitButton = await this.page.$('button[type="submit"]');
      if (submitButton) {
        await submitButton.click();
      } else {
        throw new Error("Login button not found");
      }

      // Wait for page to change with more lenient settings
      console.error("Waiting for redirect after login...");
      await Promise.race([
        this.page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 45000,
        }),
        this.page.waitForSelector(".feed-identity-module", { timeout: 45000 }),
        this.page.waitForSelector(".checkpoint", { timeout: 45000 }),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]).catch(() => {
        console.error("Navigation wait completed/timeout");
      });

      await this.randomDelay(2000, 3000);

      // Check current URL
      const currentUrl = this.page.url();
      console.error("Current URL after login:", currentUrl);

      // Check for verification/checkpoint
      if (
        currentUrl.includes("checkpoint") ||
        currentUrl.includes("challenge")
      ) {
        return {
          success: false,
          message:
            "Security checkpoint detected. Please complete the verification in the browser window. The session will be saved once you're logged in.",
          needsManualVerification: true,
        };
      }

      // Verify login success
      if (
        currentUrl.includes("/feed/") ||
        currentUrl.includes("/mynetwork/") ||
        currentUrl.includes("/home")
      ) {
        this.isLoggedIn = true;
        await this.saveCookies();
        console.error("Login successful!");
        return { success: true, message: "Login successful" };
      }

      // Check for error messages
      const errorElement = await this.page.$(
        "#error-for-password, .alert-content"
      );
      if (errorElement) {
        const errorText = await this.page.evaluate(
          (el) => el.textContent,
          errorElement
        );
        return { success: false, message: `Login failed: ${errorText}` };
      }

      // If we're still on login page, something went wrong
      if (currentUrl.includes("/login")) {
        return {
          success: false,
          message:
            "Still on login page. Please check credentials or complete verification manually if browser is visible.",
        };
      }

      return {
        success: true,
        message:
          "Login process completed. Please verify in the browser window.",
        currentUrl,
      };
    } catch (error) {
      console.error("Login error:", error);
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

      // Wait for results - try multiple possible selectors
      try {
        await this.page.waitForSelector(
          ".scaffold-layout__list-item[data-occludable-job-id]",
          {
            timeout: 15000,
          }
        );
      } catch (e) {
        // Try alternative selector
        await this.page.waitForSelector(".jobs-search-results-list", {
          timeout: 15000,
        });
      }

      await this.randomDelay(1000, 2000);

      // Scroll to load more results
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });

      await this.randomDelay(1000, 2000);

      // Extract job listings using updated selectors
      const jobs = await this.page.evaluate(() => {
        const jobCards = document.querySelectorAll(
          "li.scaffold-layout__list-item[data-occludable-job-id]"
        );
        const results = [];

        jobCards.forEach((card) => {
          try {
            // Get job ID from the list item
            const jobId = card.getAttribute("data-occludable-job-id");

            // Find the link with job-card-container__link class
            const linkEl = card.querySelector("a.job-card-container__link");

            // Title is inside the link, in a strong tag
            const titleEl = linkEl ? linkEl.querySelector("strong") : null;

            // Company name with specific class
            const companyEl = card.querySelector(
              ".artdeco-entity-lockup__subtitle span"
            );

            // Location in the metadata wrapper
            const locationEl = card.querySelector(
              ".job-card-container__metadata-wrapper li"
            );

            // Time element
            const timeEl = card.querySelector("time");

            if (titleEl && linkEl) {
              results.push({
                title: titleEl.textContent.trim(),
                company: companyEl ? companyEl.textContent.trim() : "N/A",
                location: locationEl ? locationEl.textContent.trim() : "N/A",
                link: linkEl.href,
                postedTime: timeEl ? timeEl.getAttribute("datetime") : "N/A",
                jobId: jobId,
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
      console.error("Fetching job details from:", jobUrl);

      await this.page.goto(jobUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await this.randomDelay(2000, 3000);

      // Wait for job view layout (this is present in direct job URLs)
      await Promise.race([
        this.page.waitForSelector(".job-view-layout", { timeout: 10000 }),
        this.page.waitForSelector(".jobs-details", { timeout: 10000 }),
        this.page.waitForSelector(
          ".job-details-jobs-unified-top-card__job-title",
          { timeout: 10000 }
        ),
      ]).catch(() => {
        console.error("Waiting for selectors, continuing anyway...");
      });

      // Wait specifically for job description to load
      await this.page
        .waitForSelector(".jobs-description__content", {
          timeout: 10000,
        })
        .catch(() => {
          console.error("Job description container not found, continuing...");
        });

      await this.randomDelay(2000, 3000);

      const details = await this.page.evaluate(() => {
        const getTextContent = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : null;
        };

        // Debug: Log what we're finding
        console.log("=== DEBUG INFO ===");
        console.log(
          "Description container exists:",
          !!document.querySelector(".jobs-description__content")
        );
        console.log(
          "jobs-box__html-content exists:",
          !!document.querySelector(".jobs-box__html-content")
        );
        console.log("mt4 div exists:", !!document.querySelector(".mt4"));

        const mt4 = document.querySelector(".jobs-description__content .mt4");
        if (mt4) {
          console.log("mt4 innerHTML length:", mt4.innerHTML.length);
          console.log(
            "mt4 has p[dir=ltr]:",
            !!mt4.querySelector('p[dir="ltr"]')
          );
        }

        // Title - Direct job URLs have simpler structure
        let title =
          getTextContent(".job-details-jobs-unified-top-card__job-title h1") ||
          getTextContent(
            ".job-details-jobs-unified-top-card__sticky-header-job-title strong"
          ) ||
          "N/A";

        // Company
        let company =
          getTextContent(
            ".job-details-jobs-unified-top-card__company-name a"
          ) ||
          getTextContent(".job-details-jobs-unified-top-card__company-name") ||
          "N/A";

        // Location and metadata
        const metadataEl = document.querySelector(
          ".job-details-jobs-unified-top-card__tertiary-description-container"
        );
        let metadata = "N/A";
        let location = "N/A";

        if (metadataEl) {
          metadata = metadataEl.textContent.trim();
          // Extract location (first part before "·")
          const locationMatch = metadata.match(/^([^·]+)/);
          location = locationMatch
            ? locationMatch[1].trim()
            : metadata.split("·")[0].trim();
        }

        // Workplace preferences (Remote, Full-time, etc.)
        const preferences = [];
        const preferenceButtons = document.querySelectorAll(
          ".job-details-fit-level-preferences button"
        );
        preferenceButtons.forEach((btn) => {
          const text = btn.textContent.trim().replace(/\s+/g, " ");
          // Extract just the preference type (Remote, Full-time, etc.)
          const match = text.match(
            /(Remote|Full-time|Part-time|Contract|Hybrid|On-site)/i
          );
          if (match) preferences.push(match[1]);
        });

        // Job description from the "About the job" section
        let description = "";

        console.log("=== Attempting to extract description ===");

        // Strategy 1: Find #job-details and get its sibling .mt4
        const jobDetailsSection = document.querySelector("#job-details");

        if (jobDetailsSection) {
          console.log("✓ Found #job-details section");

          // The mt4 is a sibling of job-details in the same parent
          const parent = jobDetailsSection.parentElement;
          if (parent) {
            const mt4Div = parent.querySelector(".mt4");
            if (mt4Div) {
              console.log("✓ Found .mt4 via #job-details parent");
              description = mt4Div.textContent.trim();
              console.log("Description length:", description.length);
            }
          }
        }

        // Strategy 2: Direct query for .mt4 within jobs-description
        if (!description) {
          console.log("Trying direct .mt4 search...");
          const allMt4 = document.querySelectorAll(".mt4");
          console.log("Found", allMt4.length, ".mt4 elements");

          // Find the one with substantial content (job description)
          allMt4.forEach((el, idx) => {
            const text = el.textContent.trim();
            console.log(`  .mt4[${idx}] has ${text.length} chars`);
            if (text.length > 100 && !description) {
              description = text;
              console.log("✓ Using .mt4[" + idx + "] as description");
            }
          });
        }

        // Strategy 3: Look for article.jobs-description__container
        if (!description) {
          console.log("Trying article.jobs-description__container...");
          const articleEl = document.querySelector(
            "article.jobs-description__container"
          );
          if (articleEl) {
            console.log("✓ Found article element");
            description = articleEl.textContent.trim();
            description = description.replace(/^About the job\s*/i, "").trim();
            description = description.replace(/See less\s*$/i, "").trim();
            console.log("Description length from article:", description.length);
          }
        }

        // Strategy 4: Brute force - find any p[dir="ltr"] with lots of text
        if (!description) {
          console.log("Trying brute force p[dir='ltr'] search...");
          const allParas = document.querySelectorAll('p[dir="ltr"]');
          console.log("Found", allParas.length, "p[dir='ltr'] elements");

          allParas.forEach((p, idx) => {
            const text = p.textContent.trim();
            console.log(`  p[${idx}] has ${text.length} chars`);
            // Job descriptions are typically > 500 chars
            if (text.length > 500 && !description) {
              description = text;
              console.log("✓ Using p[" + idx + "] as description");
            }
          });
        }

        console.log("=== Final description length:", description.length, "===");
        if (description.length > 0) {
          console.log("Preview:", description.substring(0, 150) + "...");
        }

        // Hiring team info
        let hiringManager = "N/A";
        const hiringManagerName = document.querySelector(".jobs-poster__name");
        const hiringManagerTitle = document.querySelector(
          ".linked-area .text-body-small"
        );
        if (hiringManagerName) {
          hiringManager = hiringManagerName.textContent.trim();
          if (hiringManagerTitle) {
            hiringManager += " - " + hiringManagerTitle.textContent.trim();
          }
        }

        // Company info from "About the company" section
        const companyFollowersEl = document.querySelector(
          ".jobs-company .artdeco-entity-lockup__subtitle"
        );
        const companyFollowers = companyFollowersEl
          ? companyFollowersEl.textContent.trim()
          : "N/A";

        const companyIndustryEl = document.querySelector(
          ".jobs-company .t-14.mt5"
        );
        const companyIndustry = companyIndustryEl
          ? companyIndustryEl.textContent.trim()
          : "N/A";

        // Extract company size from industry line (format: "Industry · 51-200 employees · X on LinkedIn")
        let companySize = "N/A";
        if (companyIndustry !== "N/A") {
          const sizeMatch = companyIndustry.match(/(\d+-?\d*\s+employees)/i);
          if (sizeMatch) {
            companySize = sizeMatch[1];
          }
        }

        let companyDescription = "N/A";
        const companyDescEl = document.querySelector(
          ".jobs-company__company-description .inline-show-more-text"
        );
        if (companyDescEl) {
          companyDescription = companyDescEl.textContent.trim();
          // Remove "show more" button text if present
          companyDescription = companyDescription.replace(
            /…\s*show more\s*$/i,
            ""
          );
        }

        return {
          title,
          company,
          location,
          metadata,
          workplaceType: preferences.join(", ") || "N/A",
          description:
            description.substring(0, 3000) +
            (description.length > 3000 ? "..." : ""),
          hiringManager,
          companyInfo: {
            size: companySize,
            followers: companyFollowers,
            industry: companyIndustry || "N/A",
            description:
              companyDescription.substring(0, 800) +
              (companyDescription.length > 800 ? "..." : ""),
          },
        };
      });

      console.error("Successfully extracted job details");
      return { success: true, details };
    } catch (error) {
      console.error("Error in getJobDetails:", error);
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
