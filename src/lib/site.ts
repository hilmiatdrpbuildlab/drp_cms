/**
 * Links into the public website. The English pages of an article live under the market in
 * LANG_HOME.en of drp_compro's localize.js ("ie"); every article has English.
 */
export const ENGLISH_MARKET = "ie";

export const articleUrl = (siteUrl: string, slug: string) => `${siteUrl}/${ENGLISH_MARKET}/blog/${slug}/`;
