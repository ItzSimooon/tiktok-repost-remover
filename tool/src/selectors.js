// Alles, was von TikToks Web-Oberfläche abhängt, steht HIER an einer Stelle.
// TikTok ändert sein Frontend regelmäßig – wenn etwas nicht mehr gefunden wird,
// ist das die einzige Datei, die angepasst werden muss.

const REMOVE_REPOST =
  '(remove|undo|delete)\\s+repost|repost\\s+(entfernen|löschen|rückgängig)|reposts?\\s+zurückziehen';

export const TIKTOK = {
  origin: 'https://www.tiktok.com',
  home: 'https://www.tiktok.com/',
  profileUrl: (username) => `https://www.tiktok.com/@${encodeURIComponent(username)}`,
  videoUrl: (author, id) => `https://www.tiktok.com/@${encodeURIComponent(author || 'user')}/video/${id}`,

  // Nur die EXISTENZ dieses Cookies wird geprüft, um den Login zu erkennen.
  sessionCookie: 'sessionid',

  // Netzwerk-Endpunkte, deren Antworten mitgelesen werden (keine eigenen Anfragen).
  api: {
    repostList: /\/api\/repost\/item_list\b/,
    repostDelete: /\/(tiktok\/v1\/upvote\/delete|api\/repost\/(delete|cancel)|aweme\/v1\/upvote\/delete)\b/,
    // Fallback-Strategie „api“: dieselbe Anfrage, die die TikTok-Webseite beim Klick sendet.
    deletePath: '/tiktok/v1/upvote/delete',
  },

  repostTab: [
    '[data-e2e="repost-tab"]',
    '[data-e2e="reposts-tab"]',
    '[role="tab"]:text-matches("^\\s*reposts?\\s*$", "i")',
    ':is(p,span,div,button):text-matches("^\\s*reposts?\\s*$", "i")',
  ],

  shareButton: [
    '[data-e2e="share-icon"]',
    '[data-e2e="browse-share"]',
    '[data-e2e="video-share"]',
    'button[aria-label*="share" i]',
    'button[aria-label*="teilen" i]',
  ],

  removeRepostButton: [
    '[data-e2e*="repost" i]:text-matches("(remove|undo|delete|entfernen|löschen|rückgängig)", "i")',
    `button:text-matches("${REMOVE_REPOST}", "i")`,
    `[role="button"]:text-matches("${REMOVE_REPOST}", "i")`,
    `:is(div,span,p):text-matches("^\\s*(${REMOVE_REPOST})\\s*$", "i")`,
  ],

  // Wenn statt „Repost entfernen“ nur „Repost“ angeboten wird, ist das Video nicht (mehr) repostet.
  addRepostButton: [
    '[data-e2e*="repost" i]:text-matches("^\\s*(repost|reposten)\\s*$", "i")',
    ':is(button,[role="button"],div,span,p):text-matches("^\\s*(repost|reposten)\\s*$", "i")',
  ],

  videoUnavailable: [
    ':text-matches("(video (is )?currently unavailable|video ist (derzeit )?nicht verfügbar|couldn.t find this (video|account))", "i")',
  ],

  captcha: [
    '#captcha-verify-container-main-page',
    '#captcha_container',
    '.captcha-verify-container',
    '.captcha_verify_container',
    'iframe[src*="captcha" i]',
  ],
};

// Liefert den ersten sichtbaren Treffer aus einer Liste von Selektoren (oder null).
export async function firstVisible(page, selectors, timeout = 5000) {
  const deadline = Date.now() + timeout;
  do {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return null;
}

export async function anyVisible(page, selectors) {
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
  }
  return false;
}
