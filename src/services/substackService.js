const axios = require("axios");
const xml2js = require("xml2js");
const config = require("../config/config");
const logger = require("../utils/logger");
const BlogPost = require("../models/blogPost");
const cheerio = require("cheerio"); // Add this import at top

class SubstackService {
  constructor() {
    this.RSS_URL = "https://l1beat.substack.com/feed";
    this.TIMEOUT = 30000; // 30 seconds
    this.UPDATE_INTERVAL = 1 * 60 * 60 * 1000; // 1hour in milliseconds

    logger.info("SubstackService initialized", {
      rssUrl: this.RSS_URL,
      updateInterval: "1 hour",
    });
  }

  /**
   * Fetch RSS feed from Substack
   * @param {string} requestId - Request ID for tracking
   * @returns {Promise<Object>} Parsed RSS data
   */
  async fetchRSSFeed(requestId = "unknown") {
    try {
      logger.info(`[SUBSTACK RSS] Fetching RSS feed [${requestId}]`, {
        url: this.RSS_URL,
      });

      const response = await axios.get(this.RSS_URL, {
        timeout: this.TIMEOUT,
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "l1beat-blog-service",
          "Cache-Control": "no-cache",
        },
      });

      if (!response.data) {
        throw new Error("No data received from RSS feed");
      }

      logger.info(
        `[SUBSTACK RSS] Successfully fetched RSS data [${requestId}]`,
        {
          dataLength: response.data.length,
          contentType: response.headers["content-type"],
        }
      );

      // Parse XML to JSON
      const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
      });

      const parsedData = await parser.parseStringPromise(response.data);

      if (!parsedData.rss || !parsedData.rss.channel) {
        throw new Error("Invalid RSS feed structure");
      }

      const channel = parsedData.rss.channel;
      const items = Array.isArray(channel.item) ? channel.item : [channel.item];
      console.log("DEBUG - Raw items:", JSON.stringify(items, null, 2));
      console.log("DEBUG - Items count:", items ? items.length : 0);

      logger.info(`[SUBSTACK RSS] Parsed RSS feed [${requestId}]`, {
        channelTitle: channel.title,
        itemCount: items ? items.length : 0,
      });

      return {
        channel: channel,
        items: items || [],
      };
    } catch (error) {
      logger.error(`[SUBSTACK RSS] Error fetching RSS feed [${requestId}]:`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });
      throw error;
    }
  }

  // Fixed processRSSItems method for substackService.js
  // This addresses the subtitle extraction issue by using the correct RSS fields

  processRSSItems(items, requestId = "unknown") {
    try {
      logger.info(
        `[SUBSTACK PROCESS] Processing ${items.length} RSS items [${requestId}]`
      );

      const processedPosts = items
        .map((item, index) => {
          try {
            // Extract basic information
            const title = item.title || "Untitled";
            const link = item.link || item.guid;
            const pubDate = new Date(item.pubDate);

            // Generate slug from title
            const slug = this.generateSlug(title);

            // FIXED: Extract subtitle from description field (Substack puts it there)
            let subtitle = "";
            let mainContent = "";
            let cleanContent = "";

            // Get subtitle from description field
            const description = item.description || "";
            if (description && description.trim()) {
              subtitle = this.cleanSubtitle(description);
            }

            // Get main content from content:encoded
            const rawContent = item["content:encoded"] || "";
            if (rawContent) {
              cleanContent = this.cleanMainContent(rawContent);
              mainContent = cleanContent;
            } else if (description && !subtitle) {
              // Fallback: if no content:encoded and description doesn't look like subtitle
              cleanContent = this.cleanMainContent(description);
              mainContent = cleanContent;
              subtitle = ""; // No subtitle in this case
            }

            // Generate excerpt from main content only (excluding subtitle)
            const excerpt = this.generateExcerpt(mainContent);

            // Extract Substack ID from GUID or link
            const substackId = this.extractSubstackId(item.guid || link);

            // Extract categories/tags if available
            const tags = this.extractTags(item.category);

            logger.debug(
              `[SUBSTACK PROCESS] Processed item ${
                index + 1
              }: ${title} [${requestId}]`,
              {
                hasSubtitle: !!subtitle,
                subtitleLength: subtitle.length,
                contentLength: mainContent.length,
              }
            );

            return {
              title: title.trim(),
              slug: slug,
              subtitle: subtitle,
              content: cleanContent,
              mainContent: mainContent,
              excerpt: excerpt,
              publishedAt: pubDate,
              author: "The L1-Team",
              substackUrl: link,
              substackId: substackId,
              tags: tags,
              syncStatus: "pending",
            };
          } catch (itemError) {
            logger.error(
              `[SUBSTACK PROCESS] Error processing item ${
                index + 1
              } [${requestId}]:`,
              {
                error: itemError.message,
                item: {
                  title: item.title,
                  guid: item.guid,
                  link: item.link,
                },
              }
            );
            return null;
          }
        })
        .filter((post) => post !== null);

      logger.info(
        `[SUBSTACK PROCESS] Successfully processed ${processedPosts.length} posts [${requestId}]`
      );
      return processedPosts;
    } catch (error) {
      logger.error(
        `[SUBSTACK PROCESS] Error processing RSS items [${requestId}]:`,
        {
          message: error.message,
          stack: error.stack,
        }
      );
      throw error;
    }
  }

  /**
   * Sync articles with database
   * @param {string} requestId - Request ID for tracking
   * @returns {Promise<Object>} Sync result
   */
  async syncArticles(
    requestId = `sync-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)}`
  ) {
    try {
      logger.info(`[SUBSTACK SYNC] Starting article sync [${requestId}]`);

      // Fetch RSS feed
      const rssData = await this.fetchRSSFeed(requestId);

      if (!rssData.items || rssData.items.length === 0) {
        logger.warn(
          `[SUBSTACK SYNC] No articles found in RSS feed [${requestId}]`
        );
        return { success: true, synced: 0, updated: 0, errors: 0 };
      }

      // Process RSS items
      const processedPosts = this.processRSSItems(rssData.items, requestId);

      let syncedCount = 0;
      let updatedCount = 0;
      let errorCount = 0;

      // Sync each post
      for (const postData of processedPosts) {
        try {
          // Calculate reading time
          const readingTime = this.calculateReadingTime(postData.content);

          // Prepare data for database
          const dbData = {
            ...postData,
            readTime: readingTime, // Fixed field name
            lastSynced: new Date(),
            syncStatus: "synced",
            // Ensure new fields have defaults
            subtitle: postData.subtitle || "",
            mainContent: postData.mainContent || postData.content,
          };

          // Update or create post
          const result = await BlogPost.findOneAndUpdate(
            { substackId: postData.substackId },
            { $set: dbData },
            {
              upsert: true,
              new: true,
              setDefaultsOnInsert: true,
            }
          );

          if (result.isNew || result.lastModified) {
            updatedCount++;
          }
          syncedCount++;

          logger.debug(
            `[SUBSTACK SYNC] Synced post: ${postData.title} [${requestId}]`
          );
        } catch (postError) {
          errorCount++;
          logger.error(`[SUBSTACK SYNC] Error syncing post [${requestId}]:`, {
            title: postData.title,
            error: postError.message,
          });
        }
      }

      logger.info(`[SUBSTACK SYNC] Sync completed [${requestId}]`, {
        totalPosts: processedPosts.length,
        synced: syncedCount,
        updated: updatedCount,
        errors: errorCount,
      });

      return {
        success: true,
        totalPosts: processedPosts.length,
        synced: syncedCount,
        updated: updatedCount,
        errors: errorCount,
        requestId: requestId,
      };
    } catch (error) {
      logger.error(`[SUBSTACK SYNC] Sync failed [${requestId}]:`, {
        message: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
        requestId: requestId,
      };
    }
  }

  /**
   * Get all blog posts with caching
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Blog posts
   */
  async getBlogPosts(options = {}) {
    try {
      const { limit = 10, offset = 0, tag } = options;

      // Check cache first
      const cacheManager = require("../utils/cacheManager");
      const cacheKey = `blog_posts_${limit}_${offset}_${tag || "all"}`;
      const cachedPosts = cacheManager.get(cacheKey);

      if (cachedPosts) {
        logger.debug("Returning cached blog posts");
        return cachedPosts;
      }

      let query = { syncStatus: "synced" };
      if (tag) {
        query.tags = { $in: [tag] };
      }

      const posts = await BlogPost.find(query)
        .sort({ publishedAt: -1 })
        .limit(limit)
        .skip(offset)
        .select("-content") // Exclude full content for list view
        .lean();

      // Cache the results for 10 minutes
      cacheManager.set(cacheKey, posts, 10 * 60 * 1000);

      logger.info(`Retrieved ${posts.length} blog posts`, {
        limit,
        offset,
        tag,
      });
      return posts;
    } catch (error) {
      logger.error("Error retrieving blog posts:", {
        message: error.message,
        options: options,
      });
      throw error;
    }
  }

  /**
   * Get single blog post by slug
   * @param {string} slug - Post slug
   * @returns {Promise<Object>} Blog post
   */
  async getBlogPostBySlug(slug) {
    try {
      // Check cache first
      const cacheManager = require("../utils/cacheManager");
      const cacheKey = `blog_post_${slug}`;
      const cachedPost = cacheManager.get(cacheKey);

      if (cachedPost) {
        logger.debug(`Returning cached blog post: ${slug}`);
        return cachedPost;
      }

      const post = await BlogPost.findOne({
        slug: slug,
        syncStatus: "synced",
      }).lean();

      if (!post) {
        throw new Error("Blog post not found");
      }

      // Cache the result for 5 minutes
      cacheManager.set(cacheKey, post, 5 * 60 * 1000);

      logger.info(`Retrieved blog post: ${slug}`);
      return post;
    } catch (error) {
      logger.error(`Error retrieving blog post by slug: ${slug}`, {
        message: error.message,
      });
      throw error;
    }
  }

  // Helper methods
  generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim("-")
      .substring(0, 100);
  }

  /**
   * Clean subtitle from RSS description field
   * @param {string} description - RSS description field
   * @returns {string} Clean subtitle
   */
  cleanSubtitle(description) {
    if (!description) return "";

    // Remove HTML tags
    let subtitle = description.replace(/<[^>]*>/g, "").trim();

    // Remove common Substack prefixes/suffixes
    subtitle = subtitle.replace(/^(Subtitle:|Summary:)/i, "").trim();

    // Limit length for subtitles (should be concise)
    if (subtitle.length > 200) {
      subtitle = subtitle.substring(0, 200).trim() + "...";
    }

    // Check if this looks like a subtitle vs main content
    // Subtitles are usually shorter and don't have multiple sentences
    const sentences = subtitle
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);
    if (sentences.length > 3 || subtitle.length > 150) {
      // This looks more like content than a subtitle
      return "";
    }

    return subtitle;
  }

  /**
   * Enhanced content cleaning with better structure and formatting
   * @param {string} content - Raw HTML content from Substack
   * @returns {string} Clean, well-structured HTML
   */
  cleanMainContent(content) {
    if (!content) return "";

    // Remove CDATA wrappers
    let cleanContent = content.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1");

    // Load into cheerio for DOM manipulation
    const $ = cheerio.load(cleanContent);

    // Remove unwanted elements
    $(
      'script, style, iframe[src*="substack"], .subscription-widget, .captioned-button'
    ).remove();

    // Clean up Substack-specific classes and attributes
    $("*").removeAttr("class").removeAttr("id").removeAttr("style");

    // Process paragraphs
    $("p").each((i, elem) => {
      const $p = $(elem);
      const text = $p.text().trim();

      // Remove empty paragraphs
      if (!text) {
        $p.remove();
        return;
      }

      // Add proper spacing classes
      $p.addClass("mb-6 leading-relaxed text-gray-700 dark:text-gray-300");
    });

    // Process headings
    $("h1, h2, h3, h4, h5, h6").each((i, elem) => {
      const $h = $(elem);
      const tagName = elem.tagName.toLowerCase();

      // Add appropriate classes based on heading level
      const headingClasses = {
        h1: "text-3xl font-bold mt-12 mb-6 text-gray-900 dark:text-white",
        h2: "text-2xl font-bold mt-10 mb-5 text-gray-900 dark:text-white",
        h3: "text-xl font-semibold mt-8 mb-4 text-gray-900 dark:text-white",
        h4: "text-lg font-semibold mt-6 mb-3 text-gray-900 dark:text-white",
        h5: "text-base font-semibold mt-4 mb-2 text-gray-900 dark:text-white",
        h6: "text-sm font-semibold mt-4 mb-2 text-gray-700 dark:text-gray-300",
      };

      $h.addClass(headingClasses[tagName] || headingClasses.h4);
    });

    // Process images
    $("img").each((i, elem) => {
      const $img = $(elem);
      const src = $img.attr("src");
      const alt = $img.attr("alt") || "";

      // Add responsive image classes
      $img.addClass("w-full h-auto rounded-lg my-8 shadow-lg");
      $img.removeAttr("width").removeAttr("height");

      // Wrap in figure if not already
      if (!$img.parent().is("figure")) {
        $img.wrap('<figure class="my-8"></figure>');
        if (alt) {
          $img.after(
            `<figcaption class="text-sm text-gray-600 dark:text-gray-400 text-center mt-2 italic">${alt}</figcaption>`
          );
        }
      }
    });

    // Process links
    $("a").each((i, elem) => {
      const $a = $(elem);
      $a.addClass(
        "text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline transition-colors"
      );

      // Open external links in new tab
      const href = $a.attr("href");
      if (href && href.startsWith("http") && !href.includes("l1beat.io")) {
        $a.attr("target", "_blank").attr("rel", "noopener noreferrer");
      }
    });

    // Process lists
    $("ul, ol").each((i, elem) => {
      const $list = $(elem);
      $list.addClass("my-6 pl-6 space-y-2");

      if (elem.tagName.toLowerCase() === "ul") {
        $list.addClass("list-disc");
      } else {
        $list.addClass("list-decimal");
      }

      $list.find("li").each((j, li) => {
        $(li).addClass("text-gray-700 dark:text-gray-300 leading-relaxed");
      });
    });

    // Process blockquotes
    $("blockquote").each((i, elem) => {
      const $bq = $(elem);
      $bq.addClass(
        "border-l-4 border-blue-500 pl-6 py-2 my-8 bg-gray-50 dark:bg-gray-800 rounded-r-lg"
      );
      $bq
        .find("p")
        .addClass("text-gray-700 dark:text-gray-300 italic font-medium");
    });

    // Process code blocks and inline code
    $("pre").each((i, elem) => {
      const $pre = $(elem);
      $pre.addClass(
        "bg-gray-900 text-green-400 p-4 rounded-lg my-6 overflow-x-auto"
      );
      $pre.find("code").addClass("text-sm font-mono");
    });

    $("code")
      .not("pre code")
      .each((i, elem) => {
        const $code = $(elem);
        $code.addClass(
          "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded text-sm font-mono"
        );
      });

    // Process tables
    $("table").each((i, elem) => {
      const $table = $(elem);
      $table.addClass("w-full my-8 border-collapse");
      $table.wrap('<div class="overflow-x-auto"></div>');

      $table
        .find("th")
        .addClass(
          "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white font-semibold p-3 border border-gray-300 dark:border-gray-600 text-left"
        );
      $table
        .find("td")
        .addClass(
          "p-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
        );
    });

    // Process horizontal rules
    $("hr").each((i, elem) => {
      $(elem).addClass("my-12 border-gray-300 dark:border-gray-600");
    });

    // Clean up any remaining empty elements
    $("p, div, span").each((i, elem) => {
      const $elem = $(elem);
      if (
        !$elem.text().trim() &&
        $elem.find("img, video, iframe").length === 0
      ) {
        $elem.remove();
      }
    });

    // Get the final HTML
    let finalHtml = $.html();

    // Clean up any double spaces or line breaks
    finalHtml = finalHtml.replace(/\s+/g, " ").trim();

    return finalHtml;
  }

  /**
   * Generate excerpt from main content only (excluding subtitle)
   * @param {string} mainContent - Main content without subtitle
   * @param {number} maxLength - Maximum length
   * @returns {string} Excerpt
   */
  generateExcerpt(mainContent, maxLength = 200) {
    if (!mainContent) return "";

    // Remove HTML tags
    const textContent = mainContent.replace(/<[^>]*>/g, " ");
    // Clean up whitespace
    const cleanText = textContent.replace(/\s+/g, " ").trim();
    // Truncate to maxLength
    if (cleanText.length <= maxLength) return cleanText;
    return cleanText.substring(0, maxLength).replace(/\s+\w*$/, "") + "...";
  }

  extractSubstackId(guid) {
    // Extract ID from GUID or URL
    if (!guid) return Date.now().toString();

    // Handle different guid formats (string, object, etc.)
    let guidString = "";
    if (typeof guid === "string") {
      guidString = guid;
    } else if (typeof guid === "object") {
      // Some RSS feeds have guid as object with _ property or text content
      guidString = guid._ || guid.text || guid.value || JSON.stringify(guid);
    } else {
      guidString = String(guid);
    }

    // Try to extract ID from URL
    const match = guidString.match(/\/p\/([^\/]+)/);
    if (match) return match[1];

    // Try to extract from substack URL pattern
    const substackMatch = guidString.match(/([a-zA-Z0-9-]+)\.substack\.com/);
    if (substackMatch) return substackMatch[1];

    // Fallback: use the full GUID as ID (clean it up)
    return (
      guidString.replace(/[^\w-]/g, "").substring(0, 50) ||
      Date.now().toString()
    );
  }

  extractTags(category) {
    if (!category) return [];
    if (Array.isArray(category)) return category;
    return [category];
  }

  calculateReadingTime(content) {
    if (!content) return 0;
    const textContent = content.replace(/<[^>]*>/g, " ");
    const wordCount = textContent.trim().split(/\s+/).length;
    return Math.ceil(wordCount / 200); // 200 words per minute
  }
  /**
   * Process Substack embeds and media
   * @param {string} content - HTML content
   * @returns {string} Content with processed embeds
   */
  processSubstackEmbeds(content) {
    const $ = cheerio.load(content);

    // Process Twitter embeds
    $('blockquote[class*="twitter"]').each((i, elem) => {
      const $tweet = $(elem);
      const tweetUrl = $tweet.find("a").last().attr("href");
      if (tweetUrl) {
        $tweet.replaceWith(`
                <div class="twitter-embed my-8 p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <p class="text-gray-600 dark:text-gray-400 mb-2">📱 Twitter Post</p>
                    <a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">
                        View on Twitter →
                    </a>
                </div>
            `);
      }
    });

    // Process YouTube embeds
    $('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').each((i, elem) => {
      const $iframe = $(elem);
      const src = $iframe.attr("src");
      $iframe.addClass("w-full aspect-video rounded-lg my-8");
      $iframe.wrap('<div class="relative"></div>');
    });

    return $.html();
  }
}

module.exports = new SubstackService();
