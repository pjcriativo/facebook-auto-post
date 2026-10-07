/**
 * Trending-topic suggestions for the "what should I make a post about"
 * moment. Two tiers, both free:
 *  1. Google Trends' unofficial daily-trends RSS feed (no key, no cost,
 *     but undocumented and can change shape or go down without notice).
 *  2. A curated list of evergreen Facebook-performing niches, always
 *     available, used whenever the feed fails or returns too little.
 */

const EVERGREEN_TOPICS = [
  "ideias de decoração aconchegante para casa",
  "receitas fáceis para o jantar durante a semana",
  "looks com guarda-roupa cápsula",
  "dicas de organização para espaços pequenos",
  "destinos econômicos para viajar no Brasil",
  "projetos faça você mesmo para renovar a casa",
  "ideias saudáveis para preparar refeições",
  "decoração minimalista para sala de estar",
  "inspirações para decoração de casamento",
  "rotina matinal de autocuidado",
  "dicas para cuidar de plantas dentro de casa",
  "como montar um espaço de trabalho bonito",
  "penteados rápidos para trabalhar",
  "ideias para jardim e quintal",
  "modelos de planner para produtividade",
  "ideias de looks para o outono",
  "decoração para festa de aniversário",
  "rotina de cuidados para uma pele saudável",
  "atividades para fazer com crianças em casa",
  "ideias de decoração para home office",
];

export function pickEvergreenTopics(count = 8): string[] {
  const shuffled = [...EVERGREEN_TOPICS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function fetchGoogleTrends(geo: string): Promise<string[]> {
  const res = await fetch(
    `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${encodeURIComponent(geo)}`,
    { signal: AbortSignal.timeout(8_000), next: { revalidate: 3600 } }
  );
  if (!res.ok) throw new Error(`Google Trends RSS ${res.status}`);
  const xml = await res.text();

  const titles = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)]
    .map((m) => m[1].trim())
    .filter((t) => t && !/daily search trends/i.test(t));

  return [...new Set(titles)];
}

export async function getTrendingTopics(geo = "BR"): Promise<{ topics: string[]; source: "trends" | "evergreen" }> {
  try {
    const topics = await fetchGoogleTrends(geo);
    if (topics.length >= 4) {
      return { topics: topics.slice(0, 12), source: "trends" };
    }
  } catch {
    // fall through to evergreen
  }
  return { topics: pickEvergreenTopics(12), source: "evergreen" };
}
