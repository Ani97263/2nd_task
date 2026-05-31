
window.player_position_x = 0;
window.player_position_y = 0;

const single_global_state_object = {
    engineRunning: false,
    paused: false,
    gameState: 'MENU', 
    score: 0,
    credits: 0,
    currentSectorIndex: 1,
    canvas: null,
    ctx: null,
    audioCtx: null,
    
    player: {
        x: 100, y: 300, radius: 14,
        speed: 4, 
        hitsSustained: 0,
        maxHitsAllowed: 5, 
        damage: 20, fireRate: 250, lastFired: 0,
        hasSplitFire: false, speedBoostActive: false,
        speedBoostTimer: 0
    },
    
    bulletsHead: null, 
    enemies: [],
    particles: [],
    lootDrops: [],
    currentRoom: null,
    input: { w: false, a: false, s: false, d: false, mouseX: 0, mouseY: 0, clicked: false }
};

const AudioSynth = {
    init() {
        if (!single_global_state_object.audioCtx) {
            single_global_state_object.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    play(type) {
        if (!single_global_state_object.audioCtx) return;
        const ctx = single_global_state_object.audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (type === 'laser') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(550, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.12);
            gain.gain.setValueAtTime(0.12, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'hit') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(140, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
            gain.gain.setValueAtTime(0.25, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'explosion') {
            osc.type = 'square'; osc.frequency.setValueAtTime(90, now);
            osc.frequency.exponentialRampToValueAtTime(20, now + 0.4);
            gain.gain.setValueAtTime(0.35, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            osc.start(now); osc.stop(now + 0.4);
        } else if (type === 'pickup') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
            gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
            osc.start(now); osc.stop(now + 0.18);
        }
    }
};

function createBulletNode(x, y, vx, vy, isEnemy, damage) {
    return { x, y, vx, vy, isEnemy, damage, radius: 4, bounces: 0, maxBounces: 2, prev: null, next: null };
}

function appendBullet(node) {
    if (!single_global_state_object.bulletsHead) {
        single_global_state_object.bulletsHead = node;
    } else {
        node.next = single_global_state_object.bulletsHead;
        single_global_state_object.bulletsHead.prev = node;
        single_global_state_object.bulletsHead = node;
    }
}

function removeBulletNode(node) {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (single_global_state_object.bulletsHead === node) {
        single_global_state_object.bulletsHead = node.next;
    }
}

const SAT = {
    getOmniBoxVertices(x, y, w, h) {
        return [{x, y}, {x: x + w, y}, {x: x + w, y: y + h}, {x, y: y + h}];
    },
    checkCirclePolygon(cx, cy, radius, vertices) {
        let minOverlap = Infinity; let smallestAxis = null; const len = vertices.length;
        for (let i = 0; i < len; i++) {
            const p1 = vertices[i], p2 = vertices[(i + 1) % len];
            const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
            const axis = { x: -edge.y, y: edge.x };
            const mag = Math.hypot(axis.x, axis.y);
            axis.x /= mag; axis.y /= mag;
            const polyProj = this.projectPolygon(vertices, axis);
            const circleProj = this.projectCircle(cx, cy, radius, axis);
            const overlap = Math.min(polyProj.max, circleProj.max) - Math.max(polyProj.min, circleProj.min);
            if (overlap <= 0) return null;
            if (overlap < minOverlap) { minOverlap = overlap; smallestAxis = axis; }
        }
        let closestVertex = vertices[0]; let minDist = Math.hypot(vertices[0].x - cx, vertices[0].y - cy);
        for (let i = 1; i < len; i++) {
            const d = Math.hypot(vertices[i].x - cx, vertices[i].y - cy);
            if (d < minDist) { minDist = d; closestVertex = vertices[i]; }
        }
        const vAxis = { x: closestVertex.x - cx, y: closestVertex.y - cy };
        const vMag = Math.hypot(vAxis.x, vAxis.y);
        if (vMag > 0) {
            vAxis.x /= vMag; vAxis.y /= vMag;
            const polyProj = this.projectPolygon(vertices, vAxis);
            const circleProj = this.projectCircle(cx, cy, radius, vAxis);
            const overlap = Math.min(polyProj.max, circleProj.max) - Math.max(polyProj.min, circleProj.min);
            if (overlap <= 0) return null;
            if (overlap < minOverlap) { minOverlap = overlap; smallestAxis = vAxis; }
        }
        const centerToPoly = { x: vertices[0].x - cx, y: vertices[0].y - cy };
        if (centerToPoly.x * smallestAxis.x + centerToPoly.y * smallestAxis.y < 0) {
            smallestAxis.x = -smallestAxis.x; smallestAxis.y = -smallestAxis.y;
        }
        return { overlap: minOverlap, normal: smallestAxis };
    },
    projectPolygon(vertices, axis) {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < vertices.length; i++) {
            const dot = vertices[i].x * axis.x + vertices[i].y * axis.y;
            if (dot < min) min = dot; if (dot > max) max = dot;
        }
        return { min, max };
    },
    projectCircle(cx, cy, r, axis) {
        const cDot = cx * axis.x + cy * axis.y; return { min: cDot - r, max: cDot + r };
    }
};

function generateProceduralRoom(sectorIndex) {
    const w = 960, h = 600;
    const room = { width: w, height: h, obstacles: [], door: { x: w - 30, y: h / 2 - 40, width: 20, height: 80, open: false } };
    room.obstacles.push(SAT.getOmniBoxVertices(0, 0, w, 20));
    room.obstacles.push(SAT.getOmniBoxVertices(0, h - 20, w, 20));
    room.obstacles.push(SAT.getOmniBoxVertices(0, 0, 20, h));
    room.obstacles.push(SAT.getOmniBoxVertices(w - 20, 0, 20, h / 2 - 40));
    room.obstacles.push(SAT.getOmniBoxVertices(w - 20, h / 2 + 40, 20, h / 2 - 40));

    const iterations = 4;
    for (let i = 0; i < iterations; i++) {
        const obsW = 70 + Math.floor(Math.random() * 50);
        const obsH = 70 + Math.floor(Math.random() * 50);
        const obsX = 250 + (i * 140);
        const obsY = 120 + Math.floor(Math.random() * 200);
        room.obstacles.push(SAT.getOmniBoxVertices(obsX, obsY, obsW, obsH));
    }
    return room;
}

const enemy_manager_singleton_controller_factory = {
    spawnPool(room, sectorIndex) {
        single_global_state_object.enemies = [];
        const count = 2 + sectorIndex;
        const types = ['HUNTER', 'DASH', 'EXPLOSIVE'];
        for (let i = 0; i < count; i++) {
            const type = types[i % types.length];
            let ex = 400 + (i * 100);
            let ey = 150 + (i * 80);
            single_global_state_object.enemies.push({
                x: ex, y: ey, radius: 14, type: type, state: 'CHASE', health: 25 + (sectorIndex * 5),
                speed: 1.5, lastActionTime: 0, targetAngle: 0, alertStatus: true
            });
        }
    },
    updateAI(bot, pX, pY, now) {
        const dist = Math.hypot(pX - bot.x, pY - bot.y);
        bot.targetAngle = Math.atan2(pY - bot.y, pX - bot.x);
        
        if (bot.type === 'HUNTER') {
            bot.x += Math.cos(bot.targetAngle) * bot.speed; bot.y += Math.sin(bot.targetAngle) * bot.speed;
            if (dist < 300 && now - bot.lastActionTime > 1200) {
                appendBullet(createBulletNode(bot.x, bot.y, Math.cos(bot.targetAngle) * 5, Math.sin(bot.targetAngle) * 5, true, 1));
                AudioSynth.play('laser'); bot.lastActionTime = now;
            }
        } else if (bot.type === 'DASH') {
            bot.x += Math.cos(bot.targetAngle) * bot.speed; bot.y += Math.sin(bot.targetAngle) * bot.speed;
        } else if (bot.type === 'EXPLOSIVE') {
            bot.x += Math.cos(bot.targetAngle) * (bot.speed * 1.2); bot.y += Math.sin(bot.targetAngle) * (bot.speed * 1.2);
            if (dist < bot.radius + single_global_state_object.player.radius + 2) {
                bot.health = 0;
                single_global_state_object.player.hitsSustained++;
                AudioSynth.play('explosion');
                if (single_global_state_object.player.hitsSustained >= single_global_state_object.player.maxHitsAllowed) {
                    terminateEngineRun(false);
                }
            }
        }
        this.resolveObstacleCollisions(bot);
    },
    resolveObstacleCollisions(entity) {
        for (const wall of single_global_state_object.currentRoom.obstacles) {
            const satHit = SAT.checkCirclePolygon(entity.x, entity.y, entity.radius, wall);
            if (satHit) {
                entity.x -= satHit.normal.x * satHit.overlap; entity.y -= satHit.normal.y * satHit.overlap;
            }
        }
    }
};


function renderVisibilityPolygons(ctx, pX, pY, room) {
    const rayCount = 120;
    const maxVisionRange = 450;
    const endpoints = [];

    for (let i = 0; i < rayCount; i++) {
        const angle = (i / rayCount) * Math.PI * 2;
        const dx = Math.cos(angle); const dy = Math.sin(angle);
        let currentRayDist = maxVisionRange;

        for (const wall of room.obstacles) {
            for (let j = 0; j < wall.length; j++) {
                const p1 = wall[j]; const p2 = wall[(j + 1) % wall.length];
                const den = (p1.x - p2.x) * dy - (p1.y - p2.y) * dx;
                if (den === 0) continue;
                const t = ((p1.x - pX) * dy - (p1.y - pY) * dx) / den;
                const u = -((p1.x - p2.x) * (p1.y - pY) - (p1.y - p2.y) * (p1.x - pX)) / den;
                if (t >= 0 && t <= 1 && u >= 0 && u < currentRayDist) currentRayDist = u;
            }
        }
        endpoints.push({ x: pX + dx * currentRayDist, y: pY + dy * currentRayDist });
    }

    ctx.save()
    ctx.fillStyle = "#04060a";
    ctx.fillRect(0, 0, room.width, room.height);

    ctx.beginPath();
    ctx.moveTo(endpoints[0].x, endpoints[0].y);
    for (let i = 1; i < endpoints.length; i++) ctx.lineTo(endpoints[i].x, endpoints[i].y);
    ctx.closePath();
    ctx.clip();

    // Dark Floor Background Value Layer Inside Line-Of-Sight
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, room.width, room.height);
    
    // Subtle Dark Tactical Radar Grid Configuration Lines
    ctx.strokeStyle = "#111826";
    ctx.lineWidth = 1;
    for (let x = 0; x < room.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, room.height); ctx.stroke();
    }
    for (let y = 0; y < room.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(room.width, y); ctx.stroke();
    }
    ctx.restore();
}

function render_entities_and_update_state() {
    const s = single_global_state_object;
    if (!s.engineRunning || s.paused) return;

    const now = performance.now();
    if (s.input.w) s.player.y -= s.player.speed;
    if (s.input.s) s.player.y += s.player.speed;
    if (s.input.a) s.player.x -= s.player.speed;
    if (s.input.d) s.player.x += s.player.speed;

    enemy_manager_singleton_controller_factory.resolveObstacleCollisions(s.player);

    if (s.input.clicked && now - s.player.lastFired > s.player.fireRate) {
        const pAngle = Math.atan2(s.input.mouseY - s.player.y, s.input.mouseX - s.player.x);
        if (s.player.hasSplitFire) {
            appendBullet(createBulletNode(s.player.x, s.player.y, Math.cos(pAngle - 0.1) * 8, Math.sin(pAngle - 0.1) * 8, false, s.player.damage));
            appendBullet(createBulletNode(s.player.x, s.player.y, Math.cos(pAngle + 0.1) * 8, Math.sin(pAngle + 0.1) * 8, false, s.player.damage));
        } else {
            appendBullet(createBulletNode(s.player.x, s.player.y, Math.cos(pAngle) * 8, Math.sin(pAngle) * 8, false, s.player.damage));
        }
        AudioSynth.play('laser'); s.player.lastFired = now;
    }

    let bNode = s.bulletsHead;
    while (bNode !== null) {
        const nextNode = bNode.next; bNode.x += bNode.vx; bNode.y += bNode.vy;
        let destroyed = false;

        for (const wall of s.currentRoom.obstacles) {
            if (SAT.checkCirclePolygon(bNode.x, bNode.y, bNode.radius, wall)) { destroyed = true; break; }
        }

        if (!destroyed) {
            if (bNode.isEnemy) {
                if (Math.hypot(s.player.x - bNode.x, s.player.y - bNode.y) < s.player.radius + bNode.radius) {
                    s.player.hitsSustained++;
                    AudioSynth.play('hit'); destroyed = true;
                    if (s.player.hitsSustained >= s.player.maxHitsAllowed) {
                        terminateEngineRun(false);
                        return;
                    }
                }
            } else {
                for (let i = s.enemies.length - 1; i >= 0; i--) {
                    const enemy = s.enemies[i];
                    if (Math.hypot(enemy.x - bNode.x, enemy.y - bNode.y) < enemy.radius + bNode.radius) {
                        enemy.health -= bNode.damage; destroyed = true;
                        if (enemy.health <= 0) {
                            s.enemies.splice(i, 1); s.score += 100; s.credits += 15;
                            AudioSynth.play('explosion');
                        }
                        break;
                    }
                }
            }
        }
        if (destroyed) removeBulletNode(bNode);
        bNode = nextNode;
    }

    for (let i = s.enemies.length - 1; i >= 0; i--) {
        enemy_manager_singleton_controller_factory.updateAI(s.enemies[i], s.player.x, s.player.y, now);
    }

    if (s.enemies.length === 0 && !s.currentRoom.door.open) {
        s.currentRoom.door.open = true; AudioSynth.play('pickup');
    }
    if (s.currentRoom.door.open && Math.hypot(s.player.x - s.currentRoom.door.x, s.player.y - s.currentRoom.door.y) < 30) {
        advanceSectorLevel();
    }

    renderGraphicsViewport(s.ctx, s);
}

function renderGraphicsViewport(ctx, s) {
    ctx.clearRect(0, 0, s.currentRoom.width, s.currentRoom.height);
    renderVisibilityPolygons(ctx, s.player.x, s.player.y, s.currentRoom);

    ctx.fillStyle = '#0f1624'; ctx.strokeStyle = '#ff0055'; ctx.lineWidth = 2;
    for (const wall of s.currentRoom.obstacles) {
        ctx.beginPath(); ctx.moveTo(wall[0].x, wall[0].y);
        for (let i = 1; i < wall.length; i++) ctx.lineTo(wall[i].x, wall[i].y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    const door = s.currentRoom.door;
    ctx.fillStyle = door.open ? 'rgba(74, 246, 38, 0.2)' : 'rgba(255, 0, 85, 0.2)';
    ctx.strokeStyle = door.open ? '#4af626' : '#ff0055';
    ctx.fillRect(door.x, door.y, door.width, door.height); ctx.strokeRect(door.x, door.y, door.width, door.height);

    let bNode = s.bulletsHead;
    while (bNode !== null) {
        ctx.fillStyle = bNode.isEnemy ? '#ff0055' : '#4af626';
        ctx.beginPath(); ctx.arc(bNode.x, bNode.y, bNode.radius, 0, Math.PI * 2); ctx.fill();
        bNode = bNode.next;
    }

    for (const enemy of s.enemies) {
        ctx.fillStyle = enemy.type === 'EXPLOSIVE' ? '#ffaa00' : '#8822bb';
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ff0055'; ctx.stroke();
    }

    ctx.fillStyle = '#4af626'; ctx.beginPath(); ctx.arc(s.player.x, s.player.y, s.player.radius, 0, Math.PI * 2); ctx.fill();

const structuralHitsRemaining = Math.max(0, s.player.maxHitsAllowed - s.player.hitsSustained);
const calculatedPercentage = (structuralHitsRemaining / s.player.maxHitsAllowed) * 100;

document.getElementById('hp-fill').style.width = `${calculatedPercentage}%`;
document.getElementById('hud-hits-left').innerText = `${structuralHitsRemaining} / ${s.player.maxHitsAllowed}`;
document.getElementById('hud-sector').innerText = s.currentSectorIndex;
document.getElementById('hud-credits').innerText = s.credits;
document.getElementById('hud-score').innerText = s.score;
document.getElementById('hud-weapon').innerText = s.player.hasSplitFire ? "SPLIT-ARRAY FLUX BLASTER" : "STANDARDIZED BLASTER";
}

function main_game_loop() {
    render_entities_and_update_state(); requestAnimationFrame(main_game_loop);
}

function startGame() {
    AudioSynth.init(); const s = single_global_state_object;
    s.score = 0; s.credits = 0; s.currentSectorIndex = 1;
    s.player.hitsSustained = 0; s.player.x = 80; s.player.y = 300; s.player.hasSplitFire = false;
    s.bulletsHead = null; s.currentRoom = generateProceduralRoom(s.currentSectorIndex);
    enemy_manager_singleton_controller_factory.spawnPool(s.currentRoom, s.currentSectorIndex);
    s.gameState = 'PLAYING'; s.engineRunning = true; s.paused = false;
    document.getElementById('screen-overlay').style.display = 'none';
    document.getElementById('shop-modal').style.display = 'none';
}

function advanceSectorLevel() {
    const s = single_global_state_object; s.currentSectorIndex++;
    if (s.currentSectorIndex > 5) { terminateEngineRun(true); return; }
    s.player.x = 80; s.player.y = 300; s.bulletsHead = null;
    s.currentRoom = generateProceduralRoom(s.currentSectorIndex);
    enemy_manager_singleton_controller_factory.spawnPool(s.currentRoom, s.currentSectorIndex);
}

function toggleEnginePause() {
    const s = single_global_state_object; if (s.gameState !== 'PLAYING') return;
    s.paused = !s.paused;
    document.getElementById('shop-modal').style.display = s.paused ? 'block' : 'none';
}

function buyUpgrade(type, cost) {
    const s = single_global_state_object; if (s.credits < cost) return;
    s.credits -= cost;
    if (type === 'heal') s.player.hitsSustained = Math.max(0, s.player.hitsSustained - 1);
    else if (type === 'speed') s.player.speed = 5.5;
    else if (type === 'weapon') s.player.hasSplitFire = true;
    else if (type === 'damage') s.player.damage += 15;
    AudioSynth.play('pickup');
}

function terminateEngineRun(isWinResult) {
    const s = single_global_state_object; s.engineRunning = false;
    s.gameState = isWinResult ? 'WIN' : 'GAMEOVER';
    const overlay = document.getElementById('screen-overlay');
    const title = document.getElementById('overlay-title');
    const desc = document.getElementById('overlay-desc');
    const btn = document.getElementById('action-btn');

    overlay.style.display = 'flex';
    document.getElementById('shop-modal').style.display = 'none';

    if (isWinResult) {
        title.innerText = "SIMULATION SUCCESS"; title.style.color = "#4af626";
        title.style.textShadow = "0 0 15px #4af626"; desc.innerText = `All tactical sectors neutralized. Score: ${s.score}`;
        btn.innerText = "RE-INITIALIZE SIMULATION";
    } else {
        title.innerText = "MATRIX CRITICAL FAILURE"; title.style.color = "#ff0055";
        title.style.textShadow = "0 0 15px #ff0055"; desc.innerText = `Shield core completely collapsed on Sector ${s.currentSectorIndex}. Final Vector Score: ${s.score}`;
        btn.innerText = "REBOOT FRAMEWORK";
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    single_global_state_object.canvas = canvas; single_global_state_object.ctx = canvas.getContext('2d');
    window.addEventListener('keydown', e => {
        if (e.key === 'w' || e.key === 'W') single_global_state_object.input.w = true;
        if (e.key === 's' || e.key === 'S') single_global_state_object.input.s = true;
        if (e.key === 'a' || e.key === 'A') single_global_state_object.input.a = true;
        if (e.key === 'd' || e.key === 'D') single_global_state_object.input.d = true;
        if (e.key === 'p' || e.key === 'P') toggleEnginePause();
    });
    window.addEventListener('keyup', e => {
        if (e.key === 'w' || e.key === 'W') single_global_state_object.input.w = false;
        if (e.key === 's' || e.key === 'S') single_global_state_object.input.s = false;
        if (e.key === 'a' || e.key === 'A') single_global_state_object.input.a = false;
        if (e.key === 'd' || e.key === 'D') single_global_state_object.input.d = false;
    });
    canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        single_global_state_object.input.mouseX = e.clientX - rect.left;
        single_global_state_object.input.mouseY = e.clientY - rect.top;
    });
    canvas.addEventListener('mousedown', () => { single_global_state_object.input.clicked = true; });
    canvas.addEventListener('mouseup', () => { single_global_state_object.input.clicked = false; });
    requestAnimationFrame(main_game_loop);
});
