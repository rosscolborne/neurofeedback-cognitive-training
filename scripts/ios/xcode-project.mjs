// Small readers for the committed iOS project files, shared by the iOS
// release check and its tests. They read only what those checks need and
// are not general pbxproj or plist parsers.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);

/** Parses an XML property list with dict, array, string, integer and boolean values. */
export function parsePlist(xml) {
  const tokens = xml.match(/<key>[\s\S]*?<\/key>|<string>[\s\S]*?<\/string>|<string\/>|<integer>[^<]*<\/integer>|<true\/>|<false\/>|<dict\/>|<array\/>|<\/?dict>|<\/?array>/g) ?? [];
  let index = 0;
  const value = () => {
    const token = tokens[index++];
    if (token === undefined) throw new Error('Unexpected end of plist');
    if (token === '<dict>') {
      const dict = {};
      while (tokens[index] !== '</dict>') {
        const key = tokens[index++]?.match(/^<key>([\s\S]*)<\/key>$/)?.[1];
        if (key === undefined) throw new Error('Expected a plist <key>');
        dict[decode(key)] = value();
      }
      index++;
      return dict;
    }
    if (token === '<array>') {
      const array = [];
      while (tokens[index] !== '</array>') array.push(value());
      index++;
      return array;
    }
    if (token === '<dict/>') return {};
    if (token === '<array/>') return [];
    if (token === '<true/>') return true;
    if (token === '<false/>') return false;
    if (token === '<string/>') return '';
    const string = token.match(/^<string>([\s\S]*)<\/string>$/);
    if (string) return decode(string[1]);
    const integer = token.match(/^<integer>([^<]*)<\/integer>$/);
    if (integer) return Number(integer[1]);
    throw new Error(`Unexpected plist token ${token}`);
  };
  return value();
}

/**
 * Returns every XCBuildConfiguration in a project.pbxproj: its id, name, base
 * xcconfig file name, and build settings as raw strings (array values are
 * joined with spaces, quotes removed).
 */
export function buildConfigurations(pbxproj) {
  const configurations = [];
  const block = /\t\t(\w{24}) \/\* [^*]+ \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;\n([\s\S]*?)\n\t\t\};/g;
  for (const [, id, body] of pbxproj.matchAll(block)) {
    const settings = {};
    const settingsBody = body.match(/\t\t\tbuildSettings = \{\n([\s\S]*?)\n\t\t\t\};/)?.[1] ?? '';
    for (const [, key, raw] of settingsBody.matchAll(/^\t\t\t\t([\w[\]=*",.-]+) = ([\s\S]*?);$/gm)) {
      const unquoted = raw.startsWith('(')
        ? raw.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean).map(unquote).join(' ')
        : unquote(raw);
      settings[key] = unquoted;
    }
    configurations.push({
      id,
      name: body.match(/\n\t\t\tname = (\w+);/)?.[1],
      base: body.match(/\t\t\tbaseConfigurationReference = \w{24} \/\* ([^*]+?) \*\/;/)?.[1] ?? null,
      settings,
    });
  }
  return configurations;
}

function unquote(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\"/g, '"')
    : trimmed;
}

/** Maps "PBXProject App" or "PBXNativeTarget App" to the ids of its configurations. */
export function configurationLists(pbxproj) {
  const lists = {};
  const block = /\/\* Build configuration list for (PBXProject|PBXNativeTarget) "([^"]+)" \*\/ = \{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = \(\n([\s\S]*?)\n\t\t\t\);/g;
  for (const [, kind, name, ids] of pbxproj.matchAll(block)) {
    lists[`${kind} ${name}`] = [...ids.matchAll(/\w{24}/g)].map(([id]) => id);
  }
  return lists;
}
