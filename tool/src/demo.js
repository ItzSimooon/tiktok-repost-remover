import { log, patchState } from './events.js';
import { randBetween, randInt, sleep } from './throttle.js';

// Demo-Modus: gleiche Schnittstelle wie TikTokSession, aber ohne Browser und ohne Netzwerk.
// Ideal, um die Oberfläche auszuprobieren:  npm run demo

// Erfundene Beispiel-Accounts – keine echten Personen.
const CREATORS = [
  ['mara.kocht', 'Mara kocht'], ['tom.tech.tipps', 'Tom'], ['tanzschule.nord', 'Tanzschule Nord'],
  ['lena.trainiert', 'Lena'], ['imbiss.atlas', 'Imbiss-Atlas'], ['katerkarl', 'Kater Karl'],
  ['lernen.mit.ben', 'Ben'], ['jo.unterwegs', 'Jo unterwegs'], ['kai.macht.witze', 'Kai'],
  ['gruener.daumen', 'Grüner Daumen'], ['autos.am.sonntag', 'Autos am Sonntag'], ['meme.archiv', 'Meme-Archiv'],
  ['nova.live', 'Nova'], ['haushaltstricks', 'Haushaltstricks'], ['oma.backt', 'Oma backt'],
];
const TEXTS = [
  'Das musst du gesehen haben #fyp #comedy', 'Pasta in 10 Minuten, nur drei Zutaten #rezept #kochen',
  'Der Trick mit dem Sperrbildschirm, den keiner kennt #tech #tipps', 'Choreo zum neuen Song, Teil 2 #dance #trend',
  '15 Minuten Ganzkörper ohne Geräte #fitness #workout', 'Bester Döner der Stadt? Ehrlicher Test #food #berlin',
  'Er wollte doch nur spielen #katze #tiere', 'So lernst du für Klausuren in der Hälfte der Zeit #lernen #studium',
  'Versteckter Strand an der Algarve #travel #urlaub', 'POV: Montagmorgen im Büro #relatable #fyp',
  'Monstera umtopfen ohne Drama #pflanzen #diy', 'Sonntagsausfahrt mit dem 911er #cars #oldtimer',
  'Wenn Mama fragt, wer das war #meme #lustig', 'Ausschnitt aus dem Set vom Samstag #techno #dj',
  'Drei Hacks für eine saubere Küche #lifehack #haushalt', 'Werbung: mein Lieblingsprodukt für den Sommer #ad #werbung',
  'Omas Apfelkuchen, das Originalrezept #backen #rezept', 'Kalt duschen, 30 Tage lang. Ergebnis #challenge',
];

export class DemoSession {
  isOpen = false;
  onClosed = null;

  async open() {
    patchState({ browser: 'starting' });
    await sleep(700);
    this.isOpen = true;
    patchState({ browser: 'open' });
    log('ok', 'Demo: Browser „geöffnet“ (es wird kein echtes Fenster gestartet).');
    setTimeout(() => {
      if (!this.isOpen) return;
      patchState({ loggedIn: true, username: 'demo.account' });
      log('ok', 'Demo: Eingeloggt als @demo.account.');
    }, 1600);
  }

  async close() {
    this.isOpen = false;
    patchState({ browser: 'closed', loggedIn: false });
    this.onClosed?.();
  }

  async getPage() {
    return null;
  }

  async hasCaptcha() {
    return false;
  }

  async scan(_username, { signal, onItems }) {
    const all = [];
    const now = Date.now() / 1000;
    const total = 264;
    for (let batch = 0; batch * 30 < total && !signal.aborted; batch++) {
      await sleep(randBetween(350, 700), signal);
      const fresh = [];
      for (let i = batch * 30; i < Math.min(total, batch * 30 + 30); i++) {
        const [author, authorName] = CREATORS[(i * 7 + (i % 5)) % CREATORS.length];
        const id = String(7_300_000_000_000_000_000n + BigInt(i * 7919 + 13));
        const text = TEXTS[(i * 3 + Math.floor(i / 4)) % TEXTS.length];
        const createTime = Math.round(now - (i * 1.6 + Math.random()) * 86_400 - randInt(0, 40_000));
        fresh.push({
          id,
          desc: text,
          createTime,
          repostTime: null,
          author,
          authorName,
          authorAvatar: '',
          cover: '',
          duration: randInt(7, 95),
          plays: Math.round(10 ** randBetween(3, 7.2)),
          likes: Math.round(10 ** randBetween(2, 6)),
          hashtags: [...text.matchAll(/#(\w+)/g)].map((m) => m[1]),
          url: `https://www.tiktok.com/@${author}/video/${id}`,
          status: 'pending',
          error: null,
        });
      }
      all.push(...fresh);
      onItems(fresh, all.length);
    }
    return all;
  }

  async remove() {
    await sleep(randBetween(500, 1200));
    const r = Math.random();
    if (r < 0.03) return { outcome: 'error', reason: 'api', error: 'Demo: simulierter Fehler' };
    if (r < 0.05) return { outcome: 'unverified', error: 'Demo: keine Bestätigung erhalten' };
    if (r < 0.07) return { outcome: 'skipped', error: 'War bereits nicht mehr repostet' };
    return { outcome: 'removed' };
  }
}
