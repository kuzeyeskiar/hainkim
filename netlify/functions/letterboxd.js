const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Connection: "keep-alive",
};

async function fetchPage(url) {
  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: (s) => s < 500,
  });

  if (res.status === 404) throw new Error("Kullanici bulunamadi");
  if (res.status === 403) throw new Error("HTTP 403");
  if (res.status !== 200) throw new Error("HTTP " + res.status);

  return res.data;
}

function parseUserList(html) {
  const $ = cheerio.load(html);
  const users = [];
  const seen = new Set();

  // Primary: table-person cells
  $("td.table-person").each((_, td) => {
    const $td = $(td);
    const $nameLink = $td.find("a.name");
    if ($nameLink.length) {
      const href = $nameLink.attr("href") || "";
      const m = href.match(/^\/([a-z0-9_-]+)\/$/i);
      if (m) {
        const username = m[1].toLowerCase();
        const displayName = $nameLink.text().trim() || username;
        if (!seen.has(username) && !["films","lists","journal","members","activity","following","followers"].includes(username)) {
          seen.add(username);
          users.push({ username, displayName });
        }
      }
    }
  });

  // Fallback: avatar links
  if (users.length === 0) {
    $("a.avatar").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/^\/([a-z0-9_-]+)\/$/i);
      if (m) {
        const username = m[1].toLowerCase();
        if (!seen.has(username) && !["films","lists","journal","members","activity"].includes(username)) {
          seen.add(username);
          users.push({ username, displayName: username });
        }
      }
    });
  }

  // Second fallback: any person-summary links
  if (users.length === 0) {
    $(".person-summary a, .followee a, .follower a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/^\/([a-z0-9_-]+)\/$/i);
      if (m) {
        const username = m[1].toLowerCase();
        if (!seen.has(username) && !["films","lists","journal","members","activity","following","followers"].includes(username)) {
          seen.add(username);
          users.push({ username, displayName: $(a).text().trim() || username });
        }
      }
    });
  }

  return users;
}

async function fetchAllPages(username, type) {
  const allUsers = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://letterboxd.com/${username}/${type}/page/${page}/`;
    try {
      const html = await fetchPage(url);
      const users = parseUserList(html);
      if (users.length === 0) break;
      allUsers.push(...users);

      const $ = cheerio.load(html);
      const hasNext = $('a.next, .paginate-next, [rel="next"]').length > 0;
      if (!hasNext) break;

      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
  }
  return allUsers;
}

function parseProfile(html, username) {
  const $ = cheerio.load(html);
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const displayName = ogTitle
    .replace(/ on Letterboxd/i, "")
    .replace(/\s+Letterboxd/i, "")
    .trim() || username;

  const bodyText = $("body").text();
  const filmMatch = bodyText.match(/(\d[\d,]+)\s*films?/i);
  const films = filmMatch ? filmMatch[1] : "?";

  return { displayName, films };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const username =
    event.queryStringParameters && event.queryStringParameters.username
      ? event.queryStringParameters.username.toLowerCase().trim()
      : null;

  if (!username || !/^[a-z0-9_-]+$/i.test(username)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Gecersiz kullanici adi" }),
    };
  }

  try {
    const [profileHtml, following, followers] = await Promise.all([
      fetchPage("https://letterboxd.com/" + username + "/"),
      fetchAllPages(username, "following"),
      fetchAllPages(username, "followers"),
    ]);

    const profile = parseProfile(profileHtml, username);
    const followerSet = new Set(followers.map((f) => f.username));
    const followingSet = new Set(following.map((f) => f.username));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        username,
        displayName: profile.displayName,
        films: profile.films,
        followingCount: following.length,
        followersCount: followers.length,
        notFollowingBack: following.filter((f) => !followerSet.has(f.username)),
        mutual: following.filter((f) => followerSet.has(f.username)),
        notFollowing: followers.filter((f) => !followingSet.has(f.username)),
      }),
    };
  } catch (err) {
    const msg = err.message || "Bir hata olustu";
    return {
      statusCode: msg.includes("bulunamadi") ? 404 : 500,
      headers,
      body: JSON.stringify({ error: msg }),
    };
  }
};
