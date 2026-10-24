import { log, patchState } from './events.js';
import { randBetween, randInt, sleep } from './throttle.js';

// Demo-Modus: gleiche Schnittstelle wie TikTokSession, aber ohne Browser und ohne Netzwerk.
// Ideal, um die Oberfläche auszuprobieren:  npm run demo

const CREATORS = [
  ['khaby.lame', 'Khaby'], ['cookingwithmara', 'Mara kocht'], ['techtom', 'Tech Tom'],
  ['dance.daily', 'Dance Daily'], ['fitwithlena', 'Lena | Fitness'], ['berlin.food', 'Berlin Food'],
  ['catcontent', 'Cat Content'], ['studytips.de', 'Study Tips'], ['travelwithjo', 'Jo reist'],
  ['comedy.kai', 'Kai'], ['plantmom', 'Plant Mom'], ['carspotter', 'Car Spotter'],
  ['memes.de', 'Memes DE'], ['djnova', 'DJ Nova'], ['lifehacks247', 'Lifehacks 24/7'],
];
const TEXTS = [
  'Das musst du gesehen haben 😂 #fyp #comedy', 'Pasta in 10 Minuten 🍝 #rezept #kochen #foryou',
  'Neues iPhone Trick den keiner kennt #tech #tipps', 'Choreo zum neuen Song 🔥 #dance #trend',
  'Ganzkörper-Workout ohne Geräte #fitness #workout', 'Bester Döner der Stadt? #berlin #food',
  'Er wollte doch nur spielen 🐱 #katze #tiere', 'So lernst du doppelt so schnell #lernen #studium',
  'Versteckter Strand in Portugal #travel #urlaub', 'POV: Montagmorgen #relatable #fyp',
  'Monstera umtopfen leicht gemacht 🌱 #pflanzen', 'Dieses Auto ist unglaublich #cars #supercar',
  'Wenn Mama fragt wer das war #meme #lustig', 'Live Set Ausschnitt 🎧 #techno #dj',
  '3 Hacks für die Küche #lifehack #haushalt', 'Werbung | Mein Lieblingsprodukt #ad #anzeige',
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
