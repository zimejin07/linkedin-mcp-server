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

      // Extract job ID from URL
      const jobIdMatch = jobUrl.match(/\/jobs\/view\/(\d+)/);

      if (!jobIdMatch) {
        return {
          success: false,
          message: "Could not extract job ID from URL",
        };
      }

      const jobId = jobIdMatch[1];
      console.error("Extracted job ID:", jobId);

      // Enable request interception to capture API responses
      await this.page.setRequestInterception(true);

      let apiResponse = null;

      // Intercept requests
      const requestHandler = (request) => {
        const url = request.url();

        // Check if this is the job posting API request
        if (
          url.includes("/voyager/api/jobs/jobPostings/") &&
          url.includes(jobId)
        ) {
          console.error("Detected API request:", url);
        }

        request.continue();
      };

      // Intercept responses
      const responseHandler = async (response) => {
        const url = response.url();

        // Capture the job posting API response
        if (
          url.includes("/voyager/api/jobs/jobPostings/") &&
          url.includes(jobId)
        ) {
          console.error("Captured API response!");
          try {
            apiResponse = await response.json();
            console.error("API response captured successfully");
          } catch (e) {
            console.error("Failed to parse API response:", e.message);
          }
        }
      };

      this.page.on("request", requestHandler);
      this.page.on("response", responseHandler);

      // Navigate to the job page - this will trigger the API call
      console.error("Navigating to job page...");
      await this.page.goto(jobUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await this.randomDelay(3000, 4000);

      // Clean up listeners
      this.page.off("request", requestHandler);
      this.page.off("response", responseHandler);
      await this.page.setRequestInterception(false);

      // If we captured the API response, use it
      if (apiResponse && apiResponse.data) {
        console.error("Processing intercepted API response...");

        const jobData = apiResponse.data;
        const title = jobData.title || "N/A";
        const location = jobData.formattedLocation || "N/A";
        const description = jobData.description?.text || "";

        console.error("Description length from API:", description.length);

        // Extract company info
        let company = "N/A";
        let companySize = "N/A";
        let companyFollowers = "N/A";
        let companyIndustry = "N/A";
        let companyDescription = "N/A";

        if (apiResponse.included && Array.isArray(apiResponse.included)) {
          const companyData = apiResponse.included.find(
            (item) => item.$type === "com.linkedin.voyager.organization.Company"
          );

          if (companyData) {
            company = companyData.name || company;
            companyDescription = companyData.description || companyDescription;

            if (companyData.staffCountRange) {
              const range = companyData.staffCountRange;
              companySize = `${range.start}-${range.end} employees`;
            }

            if (companyData.industries && companyData.industries.length > 0) {
              companyIndustry = companyData.industries.join(", ");
            }
          }

          const followInfo = apiResponse.included.find(
            (item) => item.$type === "com.linkedin.voyager.common.FollowingInfo"
          );

          if (followInfo && followInfo.followerCount) {
            companyFollowers =
              followInfo.followerCount.toLocaleString() + " followers";
          }
        }

        const workplaceTypes = [];
        if (jobData.workRemoteAllowed) {
          workplaceTypes.push("Remote");
        }
        if (jobData.formattedEmploymentStatus) {
          workplaceTypes.push(jobData.formattedEmploymentStatus);
        }

        const metadata = [
          location,
          jobData.formattedExperienceLevel,
          `${jobData.applies || 0} applicants`,
        ]
          .filter(Boolean)
          .join(" · ");

        return {
          success: true,
          details: {
            title,
            company,
            location,
            metadata,
            workplaceType: workplaceTypes.join(", ") || "N/A",
            description:
              description.substring(0, 5000) +
              (description.length > 5000 ? "..." : ""),
            experienceLevel: jobData.formattedExperienceLevel || "N/A",
            applicants: jobData.applies || 0,
            postedAt: jobData.listedAt
              ? new Date(jobData.listedAt).toISOString()
              : "N/A",
            companyInfo: {
              size: companySize,
              followers: companyFollowers,
              industry: companyIndustry,
              description:
                companyDescription.substring(0, 1000) +
                (companyDescription.length > 1000 ? "..." : ""),
            },
          },
        };
      }

      // If API interception didn't work, fall back to DOM
      console.error(
        "API interception failed, falling back to DOM extraction..."
      );
      return await this.getJobDetailsFromDOM();
    } catch (error) {
      console.error("Error in getJobDetails:", error);
      return {
        success: false,
        message: `Error getting job details: ${error.message}`,
      };
    }
  }

  async getJobDetailsFromDOM() {
    // Fallback method using DOM scraping
    try {
      console.error("Extracting from DOM as fallback...");

      // Wait for description to load
      await this.page
        .waitForSelector(".jobs-description", { timeout: 5000 })
        .catch(() => {});

      const details = await this.page.evaluate(() => {
        const getTextContent = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : null;
        };

        const title =
          getTextContent(".job-details-jobs-unified-top-card__job-title h1") ||
          getTextContent(
            ".job-details-jobs-unified-top-card__sticky-header-job-title strong"
          ) ||
          "N/A";

        const company =
          getTextContent(
            ".job-details-jobs-unified-top-card__company-name a"
          ) ||
          getTextContent(".job-details-jobs-unified-top-card__company-name") ||
          "N/A";

        const metadataEl = document.querySelector(
          ".job-details-jobs-unified-top-card__tertiary-description-container"
        );
        let metadata = "N/A";
        let location = "N/A";

        if (metadataEl) {
          metadata = metadataEl.textContent.trim();
          const locationMatch = metadata.match(/^([^·]+)/);
          location = locationMatch
            ? locationMatch[1].trim()
            : metadata.split("·")[0].trim();
        }

        const preferences = [];
        const preferenceButtons = document.querySelectorAll(
          ".job-details-fit-level-preferences button"
        );
        preferenceButtons.forEach((btn) => {
          const text = btn.textContent.trim().replace(/\s+/g, " ");
          const match = text.match(
            /(Remote|Full-time|Part-time|Contract|Hybrid|On-site)/i
          );
          if (match) preferences.push(match[1]);
        });

        // More aggressive description extraction
        let description = "";

        console.log("=== DOM Description Extraction ===");

        // Try 1: Find by id="job-details" and get next sibling
        const jobDetailsHeading = document.querySelector("#job-details");
        if (jobDetailsHeading) {
          console.log("Found #job-details heading");
          let nextEl = jobDetailsHeading.nextElementSibling;
          if (nextEl && nextEl.classList.contains("mt4")) {
            console.log("Found mt4 sibling");
            description = nextEl.textContent.trim();
          }
        }

        // Try 2: All .mt4 elements in jobs-description
        if (!description || description.length < 100) {
          console.log("Trying all .mt4 in .jobs-description");
          const jobsDesc = document.querySelector(".jobs-description");
          if (jobsDesc) {
            const mt4s = jobsDesc.querySelectorAll(".mt4");
            console.log("Found", mt4s.length, ".mt4 elements");

            mt4s.forEach((el, i) => {
              const text = el.textContent.trim();
              console.log(`mt4[${i}] length:`, text.length);
              if (text.length > description.length && text.length > 100) {
                description = text;
              }
            });
          }
        }

        // Try 3: Get from article > div with lots of text
        if (!description || description.length < 100) {
          console.log("Trying article approach");
          const article = document.querySelector(
            "article.jobs-description__container"
          );
          if (article) {
            const allDivs = article.querySelectorAll("div");
            allDivs.forEach((div) => {
              const text = div.textContent.trim();
              // Must be > 500 chars and not contain UI text
              if (
                text.length > 500 &&
                !text.includes("Easy Apply") &&
                !text.includes("Show more options") &&
                text.length > description.length
              ) {
                description = text;
              }
            });
          }
        }

        console.log("Final description length:", description.length);
        console.log("First 100 chars:", description.substring(0, 100));

        return {
          title,
          company,
          location,
          metadata,
          workplaceType: preferences.join(", ") || "N/A",
          description:
            description.substring(0, 5000) +
            (description.length > 5000 ? "..." : ""),
          companyInfo: {
            size: "N/A",
            followers: "N/A",
            industry: "N/A",
            description: "N/A",
          },
        };
      });

      console.error(
        "DOM extraction completed, description length:",
        details.description.length
      );
      return { success: true, details };
    } catch (error) {
      return {
        success: false,
        message: `DOM extraction failed: ${error.message}`,
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
