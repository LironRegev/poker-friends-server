// server/src/index.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PokerEngine } from './game/PokerEngine.js';
import type { ClientRoomView } from './types.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

app.use(cors({ origin: ORIGIN }));
app.get('/', (_req, res) => res.send('Poker Friends Server OK'));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: ORIGIN } });

type RoomSettings = {
  currency: string;
  smallBlind: number;
  bigBlind: number;
  buyInMin: number;
  buyInDefault: number;
};

type RoomData = {
  engine: PokerEngine;
  settings: RoomSettings;
};

const rooms = new Map<string, RoomData>();

function getRoom(code: string) {
  return rooms.get(code);
}

function defaultSettings(): RoomSettings {
  return {
    currency: '₪',
    smallBlind: 1,
    bigBlind: 2,
    buyInMin: 20,
    buyInDefault: 50,
  };
}

function ensureRoom(code: string) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      engine: new PokerEngine(code),
      settings: defaultSettings(),
    });
  }
  return rooms.get(code)!;
}

function withSettings<T extends ClientRoomView>(view: T, settings: RoomSettings): T {
  return {
    ...(view as any),
    smallBlind: settings.smallBlind,
    bigBlind: settings.bigBlind,
    currency: settings.currency,
    buyInMin: settings.buyInMin,
    buyInDefault: settings.buyInDefault,
  } as T;
}

io.on('connection', (socket) => {
  // CREATE ROOM
  socket.on('createRoom', (
    payload: {
      name: string;
      stack?: number;
      smallBlind?: number;
      bigBlind?: number;
      buyInMin?: number;
      buyInDefault?: number;
      currency?: string;
    },
    cb?: (res: any) => void
  ) => {
    const code = Math.random().toString(36).slice(2,7).toUpperCase();
    const room = ensureRoom(code);

    const sb = Number.isFinite(payload.smallBlind) && Number(payload.smallBlind) > 0 ? Number(payload.smallBlind) : 1;
    const bbRaw = Number.isFinite(payload.bigBlind) && Number(payload.bigBlind) > 0 ? Number(payload.bigBlind) : 2;
    const bb = Math.max(bbRaw, sb);
    const currency = (payload.currency ?? '₪').trim() || '₪';
    const buyInMin = Number.isFinite(payload.buyInMin) && Number(payload.buyInMin) > 0 ? Number(payload.buyInMin) : 20;
    const buyInDefaultRaw = Number.isFinite(payload.buyInDefault) && Number(payload.buyInDefault) > 0
      ? Number(payload.buyInDefault)
      : (Number.isFinite(payload.stack) && Number(payload.stack)! > 0 ? Number(payload.stack) : 50);
    const buyInDefault = Math.max(buyInDefaultRaw, buyInMin);

    room.settings = { currency, smallBlind: sb, bigBlind: bb, buyInMin, buyInDefault };
    (room.engine as any).setBlinds?.(sb, bb);
    (room.engine as any).smallBlind = sb;
    (room.engine as any).bigBlind  = bb;

    const startingStack = buyInDefault;
    room.engine.addPlayer(socket.id, payload.name || 'Player', startingStack, true);

    socket.join(code);

    const privateView = withSettings(room.engine.getClientView(socket.id), room.settings);
    cb?.({ code, state: privateView });

    const broadcastView = withSettings(room.engine.getBroadcastView(), room.settings);
    io.to(code).emit('state', broadcastView);
  });

  // JOIN ROOM
  socket.on('joinRoom', (
    payload: { code: string; name: string; stack?: number },
    cb?: (res: any) => void
  ) => {
    const room = getRoom(payload.code);
    if (!room) return cb?.({ error: 'Room not found' });

    const { settings } = room;
    const desiredStack = Number.isFinite(payload.stack) && Number(payload.stack)! > 0
      ? Number(payload.stack)!
      : settings.buyInDefault;

    if (desiredStack < settings.buyInMin) {
      return cb?.({ error: `מינימום כניסה הוא ${settings.currency}${settings.buyInMin}` });
    }

    const ok = room.engine.addPlayer(socket.id, payload.name || 'Player', desiredStack, false);
    if (!ok) return cb?.({ error: 'Room full or name in use' });

    socket.join(payload.code);

    const privateView = withSettings(room.engine.getClientView(socket.id), settings);
    cb?.({ state: privateView });

    const broadcastView = withSettings(room.engine.getBroadcastView(), settings);
    io.to(payload.code).emit('state', broadcastView);
  });

  // LEAVE ROOM
  socket.on('leaveRoom', ({ code }: {code:string}) => {
    const room = getRoom(code);
    if (!room) return;
    room.engine.removePlayer(socket.id);
    socket.leave(code);
    const broadcastView = withSettings(room.engine.getBroadcastView(), room.settings);
    io.to(code).emit('state', broadcastView);
  });

  // CHAT
  socket.on('chat', ({ code, text, name }: {code:string; text:string; name:string}) => {
    io.to(code).emit('chat', { name, text, ts: Date.now() });
  });

  // START GAME — owner only (עודכן)
  socket.on('startGame', ({ code }: {code:string}, cb?: (res: any) => void) => {
    const room = getRoom(code); 
    if (!room) { cb?.({ error: 'Room not found' }); return; }

    // רק בעל החדר רשאי להתחיל משחק
    if (!room.engine.isOwner(socket.id)) {
      cb?.({ error: 'רק בעל החדר יכול להתחיל משחק' });
      return;
    }

    const { smallBlind, bigBlind } = room.settings;
    (room.engine as any).setBlinds?.(smallBlind, bigBlind);
    (room.engine as any).smallBlind = smallBlind;
    (room.engine as any).bigBlind  = bigBlind;

    room.engine.startHand();
    const broadcastView = withSettings(room.engine.getBroadcastView(), room.settings);
    io.to(code).emit('state', broadcastView);

    cb?.({ ok: true });
  });

  // KICK
  socket.on('kick', ({ code, targetId }: {code:string; targetId:string}) => {
    const room = getRoom(code); if (!room) return;
    if (!room.engine.isOwner(socket.id)) return;
    room.engine.kick(targetId);
    const broadcastView = withSettings(room.engine.getBroadcastView(), room.settings);
    io.to(code).emit('state', broadcastView);
  });

  // ACTIONS
  socket.on('action', ({ code, kind, amount }: {code:string; kind:'fold'|'check'|'call'|'bet'|'raise'; amount?:number}) => {
    const room = getRoom(code); if (!room) return;
    const changed = room.engine.playerAction(socket.id, kind, amount);
    if (changed) {
      const broadcastView = withSettings(room.engine.getBroadcastView(), room.settings);
      io.to(code).emit('state', broadcastView);
    }
  });

  // PRIVATE VIEW
  socket.on('getState', ({ code }: {code:string}, cb) => {
    const room = getRoom(code); if (!room) return cb?.({ error: 'Room not found' });
    const privateView = withSettings(room.engine.getClientView(socket.id), room.settings);
    cb?.({ state: privateView });
  });

  // SHOW / MUCK
  socket.on('showCards', ({ code }: {code:string}) => {
    const room = getRoom(code); if (!room) return;
    if (!room.engine.canReveal(socket.id)) return;
    if (room.engine.doShow(socket.id)) {
      const broadcastView = withSettings(room.engine.getBroadcastView(), room.settings);
      io.to(code).emit('state', broadcastView);
    }
  });

  socket.on('muckCards', ({ code }: {code:string}) => {
    const room = getRoom(code); if (!room) return;
    if (!room.engine.canReveal(socket.id)) return;
    if (room.engine.doMuck(socket.id)) {
      const broadcastView = withSettings(room.engine.getBroadcastView(), room.settings);
      io.to(code).emit('state', broadcastView);
    }
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      if (room.engine.hasPlayer(socket.id)) {
        room.engine.removePlayer(socket.id);
        io.to(code).emit('state', withSettings(room.engine.getBroadcastView(), room.settings));
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log('Server on http://localhost:' + PORT);
});
