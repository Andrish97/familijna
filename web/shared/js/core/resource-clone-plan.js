// Definition preparation shared by duplicate-to-self and send-to-friend.
// Authorization, demo provenance and the persisted request ID are server data.
import { baseExportSnapshot } from './base-transfer-format.js?v=v2026-11-05T23235';
import { gameExportSnapshot } from './game-transfer-format.js?v=v2026-11-05T23235';
import { mapLogoSourceImages } from './logo-transfer-source.js?v=v2026-11-05T23235';
import { parseLogoPackage } from '../../../logos/js/package.js?v=v2026-11-05T23235';


export function duplicateResourceName(name, names, suffix, maxLength = 80) {
  if (typeof suffix !== 'string' || !suffix.trim() || !Number.isInteger(maxLength) || maxLength < 12) throw new Error('invalid_copy_name');
  const existing = new Set(names);
  const base = String(name || '').trim();
  for (let number = 1; number <= existing.size + 1; number++) {
    const tail = ` ${suffix.trim()}${number === 1 ? '' : ` ${number}`}`;
    if ([...tail].length >= maxLength) throw new Error('invalid_copy_name');
    const candidate = [...base].slice(0, maxLength - [...tail].length).join('').trimEnd() + tail;
    if (!existing.has(candidate.trim())) return candidate.trim();
  }
  throw new Error('copy_name_unavailable');
}

export function isDemoCloneSource(kind, source) {
  if (source[kind]?.is_demo === true || source.demo_origin === true) return true;
  const templates = source.demo_templates || [];
  if (kind === 'game') {
    const signature = packet => JSON.stringify({type: packet.game.type, state: packet.game.state, questions: packet.questions});
    const current = signature(gameExportSnapshot(source.game, source.questions));
    return templates.some(template => {
      const packet = template.payload;
      if (!packet?.game || !Array.isArray(packet.questions)) return false;
      // Compare the same export definition, excluding names and database IDs.
      const closed = template.slot?.endsWith('_closed');
      if (current === signature(gameExportSnapshot({...packet.game, status: closed ? 'ready' : 'draft'}, packet.questions))) return true;
      // Starszy eksport (przed E21) zamieniał zamkniętą ankietę na preparowaną.
      return closed && current === signature(gameExportSnapshot({...packet.game, type: 'prepared', status: 'draft'}, packet.questions));
    });
  }
  if (kind === 'logo') {
    const signature = value => {
      const logo = parseLogoPackage(value);
      return JSON.stringify(logo.type === 'GLYPH_30x10' ? {type: logo.type, layers: logo.payload.layers} : {type: logo.type, bits: logo.payload.bits_b64});
    };
    const current = signature(source.logo);
    return templates.some(template => template.slot?.startsWith('logo_') && current === signature(template.payload));
  }
  return false;
}

export async function prepareResourceClone(kind, source, options) {
  const {action, names = [], suffix, fallbackName, materializeImage} = options;
  if (!['duplicate', 'send'].includes(action) || !['game', 'base', 'logo'].includes(kind) || action === 'send' && kind === 'base') throw new Error('invalid_copy_action');
  const root = source[kind];
  if (!root) throw new Error('invalid_copy_source');
  // Trusted provenance survives duplication internally, without a parent FK
  // or a visible badge. It is never accepted as proof from the request body.
  const demoOrigin = isDemoCloneSource(kind, source);
  if (action === 'send' && demoOrigin) throw new Error('demo_not_sendable');
  let definition;
  if (kind === 'game') definition = gameExportSnapshot(root, source.questions, fallbackName);
  else if (kind === 'base') definition = baseExportSnapshot(source, fallbackName);
  else {
    const logo = parseLogoPackage(root, fallbackName);
    const completed = new Map();
    logo.payload.source = await mapLogoSourceImages(logo.payload.source, async image => {
      if (typeof materializeImage !== 'function') throw new Error('copy_image_materializer_required');
      if (!completed.has(image)) completed.set(image, await materializeImage(image));
      return completed.get(image);
    });
    definition = logo;
  }
  const named = kind === 'logo' ? definition : definition[kind];
  if (action === 'duplicate') named.name = duplicateResourceName(named.name, names, suffix);
  return {kind, definition, demoOrigin};
}
