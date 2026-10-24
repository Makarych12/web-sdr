import type { Receiver } from "./ReceiverPicker";

export type ContinentName =
  | "Все"
  | "Европа"
  | "Северная Америка"
  | "Азия"
  | "Океания"
  | "Южная Америка"
  | "Африка"
  | "Другие";

export type ReceiverGeoInfo = {
  country: string;
  flag: string;
  continent: ContinentName;
  city: string;
  shortName: string;
  callsign?: string;
  frequencyRangeText: string;
  shortAddress: string;
  isIdentified: boolean;
};

type CountryRule = {
  code: string;
  ru: string;
  flag: string;
  continent: ContinentName;
  pattern: RegExp;
};

export const CONTINENTS: ContinentName[] = [
  "Все",
  "Европа",
  "Северная Америка",
  "Азия",
  "Океания",
  "Южная Америка",
  "Африка",
  "Другие",
];

const COUNTRY_RULES: CountryRule[] = [
  // Северная Америка
  {
    code: "US",
    ru: "США",
    flag: "🇺🇸",
    continent: "Северная Америка",
    pattern:
      /\b(USA|United States|U\.S\.A\.|U\.S\.|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i,
  },
  {
    code: "CA",
    ru: "Канада",
    flag: "🇨🇦",
    continent: "Северная Америка",
    pattern:
      /\b(Canada|Quebec|Québec|Ontario|Alberta|British Columbia|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland|Ottawa|Toronto|Montreal|Vancouver|Calgary|Edmonton)\b/i,
  },
  {
    code: "MX",
    ru: "Мексика",
    flag: "🇲🇽",
    continent: "Северная Америка",
    pattern: /\b(Mexico|México|Guadalajara|Monterrey|Tijuana)\b/i,
  },

  // Европа
  {
    code: "DE",
    ru: "Германия",
    flag: "🇩🇪",
    continent: "Европа",
    pattern:
      /\b(Germany|Deutschland|Bavaria|Bayern|Berlin|Hamburg|Hessen|Sachsen|Thüringen|Baden-Württemberg|Nordrhein-Westfalen|NRW|Baden|Niedersachsen|Luedinghausen|Rudolstadt|Schwerin|Bülzig|Hattingen|Niendorf|Eschweiler)\b/i,
  },
  {
    code: "FR",
    ru: "Франция",
    flag: "🇫🇷",
    continent: "Европа",
    pattern:
      /\b(France|FRANCE|Paris|Bretagne|Normandie|Provence|Occitanie|Montmorillon|Brettnach|Isere|Tremolat|Marsangy|Pradiers)\b/i,
  },
  {
    code: "GB",
    ru: "Великобритания",
    flag: "🇬🇧",
    continent: "Европа",
    pattern:
      /\b(United Kingdom|UK|England|Scotland|Wales|Northern Ireland|Great Britain|London|Chichester|Bristol|Baldock|Taunton|Herts|Wessex)\b/i,
  },
  {
    code: "IT",
    ru: "Италия",
    flag: "🇮🇹",
    continent: "Европа",
    pattern:
      /\b(Italy|Italia|Rome|Roma|Milano|Napoli|Torino|Sicilia|Sardegna|Florence|Firenze)\b/i,
  },
  {
    code: "ES",
    ru: "Испания",
    flag: "🇪🇸",
    continent: "Европа",
    pattern:
      /\b(Spain|España|Madrid|Barcelona|Valencia|Navarra|Andalucía|Canarias|Canary Islands|Fuerteventura|Tenerife)\b/i,
  },
  {
    code: "NL",
    ru: "Нидерланды",
    flag: "🇳🇱",
    continent: "Европа",
    pattern:
      /\b(Netherlands|The Netherlands|Nederland|Holland|Amsterdam|Rotterdam|Eindhoven|Fryslan|Friesland|Assen)\b/i,
  },
  {
    code: "SE",
    ru: "Швеция",
    flag: "🇸🇪",
    continent: "Европа",
    pattern:
      /\b(Sweden|Sverige|Stockholm|Gothenburg|Göteborg|Malmö|Arvika|Borås|Haparanda|Siknas)\b/i,
  },
  {
    code: "FI",
    ru: "Финляндия",
    flag: "🇫🇮",
    continent: "Европа",
    pattern:
      /\b(Finland|Suomi|Helsinki|Tampere|Muurame|Hämeenlinna|Parainen|Elimäki)\b/i,
  },
  {
    code: "NO",
    ru: "Норвегия",
    flag: "🇳🇴",
    continent: "Европа",
    pattern: /\b(Norway|Norge|Oslo|Bergen|Trondheim|Larvik)\b/i,
  },
  {
    code: "PL",
    ru: "Польша",
    flag: "🇵🇱",
    continent: "Европа",
    pattern:
      /\b(Poland|Polska|Warsaw|Warszawa|Krakow|Kraków|Wrocław|Sobikow)\b/i,
  },
  {
    code: "RU",
    ru: "Россия",
    flag: "🇷🇺",
    continent: "Европа",
    pattern:
      /\b(Russia|Россия|Moscow|Москва|Saint Petersburg|Санкт-Петербург|Tambov|Тамбов|Yekaterinburg|Екатеринбург|Novosibirsk|Новосибирск|Nev'yansk|Невьянск)\b/i,
  },
  {
    code: "UA",
    ru: "Украина",
    flag: "🇺🇦",
    continent: "Европа",
    pattern:
      /\b(Ukraine|Украина|Kyiv|Киев|Kharkiv|Харьков|Odesa|Одесса|Dnipro|Днепр|Lviv|Львов)\b/i,
  },
  {
    code: "AT",
    ru: "Австрия",
    flag: "🇦🇹",
    continent: "Европа",
    pattern:
      /\b(Austria|Österreich|Wien|Vienna|Salzburg|Innsbruck|Kufstein|Niederndorferberg)\b/i,
  },
  {
    code: "CH",
    ru: "Швейцария",
    flag: "🇨🇭",
    continent: "Европа",
    pattern:
      /\b(Switzerland|Schweiz|Suisse|Svizzera|Zurich|Zuerich|Geneva|Basel|Bern|Rigi)\b/i,
  },
  {
    code: "BE",
    ru: "Бельгия",
    flag: "🇧🇪",
    continent: "Европа",
    pattern:
      /\b(Belgium|Belgique|België|Brussels|Antwerpen|Limburg|Heppen)\b/i,
  },
  {
    code: "IE",
    ru: "Ирландия",
    flag: "🇮🇪",
    continent: "Европа",
    pattern:
      /\b(Ireland|Éire|Dublin|Cork|Galway|Limerick|Mullingar|Westmeath)\b/i,
  },
  {
    code: "DK",
    ru: "Дания",
    flag: "🇩🇰",
    continent: "Европа",
    pattern: /\b(Denmark|Danmark|Denmak|Copenhagen|Skanderborg|Hoell)\b/i,
  },
  {
    code: "CZ",
    ru: "Чехия",
    flag: "🇨🇿",
    continent: "Европа",
    pattern: /\b(Czech|Czechia|Czech Republic|Česko|Prague|Praha|Brno)\b/i,
  },
  {
    code: "SK",
    ru: "Словакия",
    flag: "🇸🇰",
    continent: "Европа",
    pattern: /\b(Slovakia|Slovensko|Bratislava)\b/i,
  },
  {
    code: "HU",
    ru: "Венгрия",
    flag: "🇭🇺",
    continent: "Европа",
    pattern:
      /\b(Hungary|Magyarország|Budapest|Szekesfehervar|Maroshegy)\b/i,
  },
  {
    code: "GR",
    ru: "Греция",
    flag: "🇬🇷",
    continent: "Европа",
    pattern: /\b(Greece|Hellas|Athens|Thessaloniki|Crete)\b/i,
  },
  {
    code: "PT",
    ru: "Португалия",
    flag: "🇵🇹",
    continent: "Европа",
    pattern: /\b(Portugal|Lisbon|Porto|Azores|Madeira)\b/i,
  },
  {
    code: "SI",
    ru: "Словения",
    flag: "🇸🇮",
    continent: "Европа",
    pattern: /\b(Slovenia|Slovenija|Ljubljana|Polsece)\b/i,
  },
  {
    code: "HR",
    ru: "Хорватия",
    flag: "🇭🇷",
    continent: "Европа",
    pattern: /\b(Croatia|Hrvatska|Zagreb|Split)\b/i,
  },
  {
    code: "RO",
    ru: "Румыния",
    flag: "🇷🇴",
    continent: "Европа",
    pattern: /\b(Romania|România|Bucharest|București)\b/i,
  },
  {
    code: "BG",
    ru: "Болгария",
    flag: "🇧🇬",
    continent: "Европа",
    pattern: /\b(Bulgaria|България|Sofia|София)\b/i,
  },
  {
    code: "IS",
    ru: "Исландия",
    flag: "🇮🇸",
    continent: "Европа",
    pattern: /\b(Iceland|Ísland|Reykjavik|Orlygshofn)\b/i,
  },
  {
    code: "EE",
    ru: "Эстония",
    flag: "🇪🇪",
    continent: "Европа",
    pattern: /\b(Estonia|Eesti|Tallinn)\b/i,
  },
  {
    code: "LV",
    ru: "Латвия",
    flag: "🇱🇻",
    continent: "Европа",
    pattern: /\b(Latvia|Latvija|Riga)\b/i,
  },
  {
    code: "LT",
    ru: "Литва",
    flag: "🇱🇹",
    continent: "Европа",
    pattern: /\b(Lithuania|Lietuva|Vilnius)\b/i,
  },
  {
    code: "LU",
    ru: "Люксембург",
    flag: "🇱🇺",
    continent: "Европа",
    pattern: /\b(Luxembourg|Lëtzebuerg)\b/i,
  },
  {
    code: "CY",
    ru: "Кипр",
    flag: "🇨🇾",
    continent: "Европа",
    pattern: /\b(Cyprus|Nicosia)\b/i,
  },

  // Азия
  {
    code: "JP",
    ru: "Япония",
    flag: "🇯🇵",
    continent: "Азия",
    pattern:
      /\b(Japan|JAPAN|Tokyo|Osaka|Hokkaido|Sapporo|Chiba|Nagano|Kyoto|Fukushima|Saitama|Hamamatsu|Kuriyama|Minowa|Oita)\b/i,
  },
  {
    code: "TH",
    ru: "Таиланд",
    flag: "🇹🇭",
    continent: "Азия",
    pattern:
      /\b(Thailand|Bangkok|Udon Thani|Khon Kaen|So Phisai)\b/i,
  },
  {
    code: "ID",
    ru: "Индонезия",
    flag: "🇮🇩",
    continent: "Азия",
    pattern:
      /\b(Indonesia|Jakarta|Bandung|Bogor|Surabaya|Bali)\b/i,
  },
  {
    code: "IN",
    ru: "Индия",
    flag: "🇮🇳",
    continent: "Азия",
    pattern:
      /\b(India|Bangalore|Bengaluru|Delhi|Mumbai|Chennai)\b/i,
  },
  {
    code: "KR",
    ru: "Южная Корея",
    flag: "🇰🇷",
    continent: "Азия",
    pattern:
      /\b(South Korea|Korea|Republic of Korea|Seoul|Daegu|Dae_Gu)\b/i,
  },
  {
    code: "TW",
    ru: "Тайвань",
    flag: "🇹🇼",
    continent: "Азия",
    pattern: /\b(Taiwan|Taipei|Kaohsiung)\b/i,
  },
  {
    code: "HK",
    ru: "Гонконг",
    flag: "🇭🇰",
    continent: "Азия",
    pattern: /\b(Hong Kong|Hongkong)\b/i,
  },
  {
    code: "PH",
    ru: "Филиппины",
    flag: "🇵🇭",
    continent: "Азия",
    pattern:
      /\b(Philippines|Pilipinas|Manila|Cebu|Negros Occidental|Talisay)\b/i,
  },
  {
    code: "IL",
    ru: "Израиль",
    flag: "🇮🇱",
    continent: "Азия",
    pattern: /\b(Israel|Tel Aviv|Jerusalem|Haifa)\b/i,
  },
  {
    code: "KW",
    ru: "Кувейт",
    flag: "🇰🇼",
    continent: "Азия",
    pattern: /\b(Kuwait)\b/i,
  },
  {
    code: "NP",
    ru: "Непал",
    flag: "🇳🇵",
    continent: "Азия",
    pattern: /\b(Nepal|Kathmandu)\b/i,
  },
  {
    code: "SG",
    ru: "Сингапур",
    flag: "🇸🇬",
    continent: "Азия",
    pattern: /\b(Singapore)\b/i,
  },
  {
    code: "MY",
    ru: "Малайзия",
    flag: "🇲🇾",
    continent: "Азия",
    pattern: /\b(Malaysia|Kuala Lumpur)\b/i,
  },
  {
    code: "TR",
    ru: "Турция",
    flag: "🇹🇷",
    continent: "Азия",
    pattern: /\b(Turkey|Türkiye|Istanbul|Ankara)\b/i,
  },

  // Океания
  {
    code: "AU",
    ru: "Австралия",
    flag: "🇦🇺",
    continent: "Океания",
    pattern:
      /\b(Australia|South Australia|Western Australia|Queensland|Victoria|New South Wales|Tasmania|NSW|QLD|VIC|WA|SA|TAS|ACT|Sydney|Melbourne|Brisbane|Perth|Adelaide|Hunter Valley|Tarlee|Ironstone Range|Strathbogie|Northam|Townsville|Esk|Yelta|Mt Barker|Hammond|Mt Eliza)\b/i,
  },
  {
    code: "NZ",
    ru: "Новая Зеландия",
    flag: "🇳🇿",
    continent: "Океания",
    pattern:
      /\b(New Zealand|Aotearoa|Auckland|Wellington|Christchurch|Canterbury|Tasman District|Masterton|Rotorua|Palmerston North|Marlborough|White Rock|Marahau|Upper Hutt|Carterton)\b/i,
  },

  // Южная Америка
  {
    code: "BR",
    ru: "Бразилия",
    flag: "🇧🇷",
    continent: "Южная Америка",
    pattern:
      /\b(Brazil|Brasil|São Paulo|Rio de Janeiro|Vinhedo)\b/i,
  },
  {
    code: "AR",
    ru: "Аргентина",
    flag: "🇦🇷",
    continent: "Южная Америка",
    pattern:
      /\b(Argentina|Buenos Aires|Cordoba|Córdoba|Alpa Corral)\b/i,
  },
  {
    code: "CL",
    ru: "Чили",
    flag: "🇨🇱",
    continent: "Южная Америка",
    pattern:
      /\b(Chile|Santiago|Valparaíso|Curacautín|Araucanía)\b/i,
  },
  {
    code: "UY",
    ru: "Уругвай",
    flag: "🇺🇾",
    continent: "Южная Америка",
    pattern: /\b(Uruguay|Montevideo)\b/i,
  },
  {
    code: "CO",
    ru: "Колумбия",
    flag: "🇨🇴",
    continent: "Южная Америка",
    pattern: /\b(Colombia|Bogota|Medellin)\b/i,
  },

  // Африка
  {
    code: "ZA",
    ru: "ЮАР",
    flag: "🇿🇦",
    continent: "Африка",
    pattern: /\b(South Africa|Johannesburg|Cape Town|Durban)\b/i,
  },
];

/**
 * Extracts callsign token if present in name (e.g. VK5ARG, ZL2P, K9DXI, W4GUZ)
 */
function extractCallsign(name: string): string | undefined {
  const match = name.match(/\b([A-Z0-9]{1,3}\d[A-Z0-9]{1,4})\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Formats frequency range into compact human string (e.g. "0–30 МГц" or "1.8–30 МГц")
 */
function formatFrequencyRange(minKHz?: number, maxKHz?: number): string {
  if (minKHz === undefined && maxKHz === undefined) return "0–30 МГц";
  const min = (minKHz ?? 0) / 1000;
  const max = (maxKHz ?? 30000) / 1000;
  const minStr = Number.isInteger(min) ? min.toString() : min.toFixed(1);
  const maxStr = Number.isInteger(max) ? max.toString() : max.toFixed(1);
  return `${minStr}–${maxStr} МГц`;
}

/**
 * Formats a clean short address string (hostname, direct indicator, or proxy ID)
 */
function formatShortAddress(receiver: Receiver): string {
  if (receiver.directUrl) {
    try {
      const u = new URL(receiver.directUrl);
      return u.host;
    } catch {
      return "Прямой WSS";
    }
  }
  const cleanId = receiver.id.replace(/^kiwi-/, "#");
  return `Шлюз · ${cleanId.slice(0, 10)}`;
}

/**
 * Strips decoration and extracts a clean primary station title
 */
function formatShortName(name: string): string {
  if (!name) return "KiwiSDR";
  // Remove leading emojis/decorative symbols
  let clean = name.replace(/^[\s█🟠🌲►◄★🗲►◄]+\s*/u, "").trim();
  // Split by common location separator if present
  if (clean.includes(" | ")) {
    clean = clean.split(" | ")[0].trim();
  } else if (clean.includes(" · ")) {
    clean = clean.split(" · ")[0].trim();
  }
  // Remove redundant "0-30 MHz SDR" prefix if it hides the actual station name
  clean = clean.replace(/^(0[-–]3[02]\s*MHz\s*SDR|SDR|KiwiSDR)\s*[,·:-]?\s*/i, "").trim() || name;
  return clean.slice(0, 50);
}

/**
 * Parses reliable geography metadata from a Receiver
 */
export function getReceiverGeo(receiver: Receiver): ReceiverGeoInfo {
  // Extract candidate location strings:
  // 1. Explicit `receiver.location` entered by station operator
  // 2. Or location segment from `receiver.name` after | or ·
  let rawLoc = (receiver.location || "").trim();
  if (!rawLoc && receiver.name) {
    if (receiver.name.includes(" | ")) {
      rawLoc = receiver.name.split(" | ").slice(1).join(" ").trim();
    } else if (receiver.name.includes(" · ")) {
      rawLoc = receiver.name.split(" · ").slice(1).join(" ").trim();
    }
  }

  // Check against country rules
  let matchedRule: CountryRule | null = null;
  if (rawLoc) {
    for (const rule of COUNTRY_RULES) {
      if (rule.pattern.test(rawLoc)) {
        matchedRule = rule;
        break;
      }
    }
  }

  // If still not matched, check if name itself contains explicit reliable country name
  if (!matchedRule && receiver.name) {
    for (const rule of COUNTRY_RULES) {
      if (rule.pattern.test(receiver.name)) {
        matchedRule = rule;
        break;
      }
    }
  }

  const isIdentified = matchedRule !== null;
  const country = matchedRule ? matchedRule.ru : "Страна не указана";
  const flag = matchedRule ? matchedRule.flag : "🌐";
  const continent = matchedRule ? matchedRule.continent : "Другие";

  // Clean city/region: strip quotes, brackets, and redundant country suffix if matched
  let city = (receiver.location || "").trim();
  if (!city && receiver.name) {
    if (receiver.name.includes(" · ")) {
      city = receiver.name.split(" · ")[0].trim();
    } else if (receiver.name.includes(" | ")) {
      city = receiver.name.split(" | ")[1]?.trim() || "";
    }
  }

  // Remove brackets, coordinates, or trailing separators
  city = city
    .replace(/^\[.*?\]\s*/g, "")
    .replace(/^\(.*?\)\s*/g, "")
    .replace(/^[,\s·|:-]+|[,\s·|:-]+$/g, "")
    .trim();

  // If city is identical to the matched country name, try extracting from station prefix
  if (
    matchedRule &&
    (city.toLowerCase() === matchedRule.ru.toLowerCase() ||
      new RegExp(`^${matchedRule.code}$`, "i").test(city) ||
      matchedRule.pattern.test(city))
  ) {
    if (receiver.name.includes(" · ") || receiver.name.includes(" | ")) {
      const prefix = receiver.name
        .split(/[·|]/)[0]
        .replace(/^(0[-–]3[02]\s*MHz\s*SDR|SDR|KiwiSDR)\s*[,·:-]?\s*/i, "")
        .trim();
      if (prefix && prefix.toLowerCase() !== matchedRule.ru.toLowerCase()) {
        city = prefix;
      }
    }
  }

  // Strip trailing country suffixes if present (e.g. "Bakersville, NC, USA" -> "Bakersville, NC")
  if (matchedRule) {
    city = city
      .replace(new RegExp(`[,\\s·|-]+(?:USA|United States|FRANCE|France|Germany|Deutschland|JAPAN|Japan|Australia|UK|Italy|Spain|Sweden|Finland|Netherlands)$`, "i"), "")
      .trim();
  }

  if (city.length > 36) {
    city = city.slice(0, 36) + "…";
  }

  const callsign = extractCallsign(receiver.name);
  const shortName = formatShortName(receiver.name);
  const frequencyRangeText = formatFrequencyRange(
    receiver.minFrequency,
    receiver.maxFrequency,
  );
  const shortAddress = formatShortAddress(receiver);

  return {
    country,
    flag,
    continent,
    city: city || "Место не указано",
    shortName,
    callsign,
    frequencyRangeText,
    shortAddress,
    isIdentified,
  };
}
