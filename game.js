
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
        x: 100, y: 100, radius: 14,
        speed: 4, health: 100, maxHealth: 100,
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
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'hit') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        } else if (type === 'explosion') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(100, now);
            osc.frequency.exponentialRampToValueAtTime(30, now + 0.4);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            osc.start(now); osc.stop(now + 0.4);
        } else if (type === 'pickup') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
        }
    }
};

/**
 * Doubly Linked List Node Mechanics for Projectile Management
 */
function createBulletNode(x, y, vx, vy, isEnemy, damage) {
    return {
        x: x, y: y, vx: vx, vy: vy,
        isEnemy: isEnemy, damage: damage, radius: 4,
        bounces: 0, maxBounces: 3,
        prev: null, next: null
    };
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
        return [
            {x: x, y: y}, {x: x + w, y: y},
            {x: x + w, y: y + h}, {x: x, y: y + h}
        ];
    },
    
    checkCirclePolygon(cx, cy, radius, vertices) {
        let minOverlap = Infinity;
        let smallestAxis = null;
        const len = vertices.length;

        for (let i = 0; i < len; i++) {
            const p1 = vertices[i];
            const p2 = vertices[(i + 1) % len];
            const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
            const axis = { x: -edge.y, y: edge.x };
            const mag = Math.hypot(axis.x, axis.y);
            axis.x /= mag; axis.y /= mag;

            const polyProj = this.projectPolygon(vertices, axis);
            const circleProj = this.projectCircle(cx, cy, radius, axis);

            const overlap = Math.min(polyProj.max, circleProj.max) - Math.max(polyProj.min, circleProj.min);
            if (overlap <= 0) return null; 

            if (overlap < minOverlap) {
                minOverlap = overlap;
                smallestAxis = axis;
            }
        }

        let closestVertex = vertices[0];
        let minDist = Math.hypot(vertices[0].x - cx, vertices[0].y - cy);
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
            if (overlap < minOverlap) {
                minOverlap = overlap;
                smallestAxis = vAxis;
            }
        }

        const centerToPoly = { x: vertices[0].x - cx, y: vertices[0].y - cy };
        if (centerToPoly.x * smallestAxis.x + centerToPoly.y * smallestAxis.y < 0) {
            smallestAxis.x = -smallestAxis.x;
            smallestAxis.y = -smallestAxis.y;
        }

        return { overlap: minOverlap, normal: smallestAxis };
    },

    projectPolygon(vertices, axis) {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < vertices.length; i++) {
            const dot = vertices[i].x * axis.x + vertices[i].y * axis.y;
            if (dot < min) min = dot;
            if (dot > max) max = dot;
        }
        return { min, max };
    },

    projectCircle(cx, cy, r, axis) {
        const cDot = cx * axis.x + cy * axis.y;
        return { min: cDot - r, max: cDot + r };
    }
};


function generateProceduralRoom(sectorIndex) {
    const w = 960, h = 600;
    const room = {
        width: w, height: h,
        obstacles: [], 
        door: { x: w - 30, y: h / 2 - 40, width: 20, height: 80, open: false }
    };

    room.obstacles.push(SAT.getOmniBoxVertices(0, 0, w, 20)); 
    room.obstacles.push(SAT.getOmniBoxVertices(0, h - 20, w, 20)); 
    room.obstacles.push(SAT.getOmniBoxVertices(0, 0, 20, h)); 
    room.obstacles.push(SAT.getOmniBoxVertices(w - 20, 0, 20, h / 2 - 40)); 
    room.obstacles.push(SAT.getOmniBoxVertices(w - 20, h / 2 + 40, 20, h / 2 - 40)); 

    const iterations = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < iterations; i++) {
        const obsW = 60 + Math.floor(Math.random() * 80);
        const obsH = 60 + Math.floor(Math.random() * 80);
        const obsX = 200 + Math.floor(Math.random() * (w - 400));
        const obsY = 100 + Math.floor(Math.random() * (h - 250));
        room.obstacles.push(SAT.getOmniBoxVertices(obsX, obsY, obsW, obsH));
    }
    return room;
}


const enemy_manager_singleton_controller_factory = {
    spawnPool(room, sectorIndex) {
        single_global_state_object.enemies = [];
        const count = 3 + sectorIndex;
        const types = ['HUNTER', 'SNIPER', 'DASH', 'EXPLOSIVE'];

        for (let i = 0; i < count; i++) {
            const type = types[Math.floor(Math.random() * types.length)];
            let validCoord = false, ex = 0, ey = 0;

            while (!validCoord) {
                ex = 300 + Math.random() * (room.width - 400);
                ey = 100 + Math.random() * (room.height - 200);
                validCoord = true;
                for (const wall of room.obstacles) {
                    if (SAT.checkCirclePolygon(ex, ey, 20, wall)) { validCoord = false; break; }
                }
            }

            single_global_state_object.enemies.push({
                x: ex, y: ey, radius: 14, type: type,
                state: 'IDLE', health: 30 + (sectorIndex * 10),
                speed: type === 'DASH' ? 1.5 : 2,
                lastActionTime: 0, targetAngle: Math.random() * Math.PI * 2,
                laserLock: 0, dashCooldown: 0, alertStatus: false
            });
        }
    },

    updateAI(bot, pX, pY, now) {
        const distanceToPlayer = Math.hypot(pX - bot.x, pY - bot.y);
        
        if (!bot.alertStatus) {
            const currentFacingVectorX = Math.cos(bot.targetAngle);
            const currentFacingVectorY = Math.sin(bot.targetAngle);
            const dirToPlayerX = (pX - bot.x) / distanceToPlayer;
            const dirToPlayerY = (pY - bot.y) / distanceToPlayer;
            const dotProductAngle = currentFacingVectorX * dirToPlayerX + currentFacingVectorY * dirToPlayerY;

            if (distanceToPlayer < 120 || (distanceToPlayer < 300 && dotProductAngle > 0.707)) {
                bot.alertStatus = true;
                bot.state = 'CHASE';
            }
        }

        if (!bot.alertStatus) {
            if (now - bot.lastActionTime > 2000) {
                bot.targetAngle = Math.random() * Math.PI * 2;
                bot.lastActionTime = now;
            }
            const vx = Math.cos(bot.targetAngle) * (bot.speed * 0.5);
            const vy = Math.sin(bot.targetAngle) * (bot.speed * 0.5);
            bot.x += vx; bot.y += vy;
            this.resolveObstacleCollisions(bot);
            return;
        }

        bot.targetAngle = Math.atan2(pY - bot.y, pX - bot.x);

        switch (bot.type) {
            case 'HUNTER':
                bot.x += Math.cos(bot.targetAngle) * bot.speed;
                bot.y += Math.sin(bot.targetAngle) * bot.speed;
                if (distanceToPlayer < 250 && now - bot.lastActionTime > 800) {
                    appendBullet(createBulletNode(bot.x, bot.y, Math.cos(bot.targetAngle) * 6, Math.sin(bot.targetAngle) * 6, true, 10));
                    AudioSynth.play('laser');
                    bot.lastActionTime = now;
                }
                break;

            case 'SNIPER':
                if (bot.state === 'CHASE') {
                    bot.state = 'ATTACK';
                    bot.lastActionTime = now;
                }
                if (bot.state === 'ATTACK') {
                    bot.laserLock = (now - bot.lastActionTime) / 1500; 
                    if (bot.laserLock >= 1.0) {
                        appendBullet(createBulletNode(bot.x, bot.y, Math.cos(bot.targetAngle) * 12, Math.sin(bot.targetAngle) * 12, true, 30));
                        AudioSynth.play('laser');
                        bot.lastActionTime = now;
                        bot.laserLock = 0;
                    }
                }
                break;

            case 'DASH':
                if (bot.state === 'CHASE') {
                    bot.x += Math.cos(bot.targetAngle) * bot.speed;
                    bot.y += Math.sin(bot.targetAngle) * bot.speed;
                    if (distanceToPlayer < 180 && now - bot.dashCooldown > 3000) {
                        bot.state = 'DASHING';
                        bot.lastActionTime = now;
                    }
                } else if (bot.state === 'DASHING') {
                    bot.x += Math.cos(bot.targetAngle) * (bot.speed * 4.5);
                    bot.y += Math.sin(bot.targetAngle) * (bot.speed * 4.5);
                    if (now - bot.lastActionTime > 300) { 
                        bot.state = 'CHASE';
                        bot.dashCooldown = now;
                    }
                }
                break;

            case 'EXPLOSIVE':
                bot.x += Math.cos(bot.targetAngle) * (bot.speed * 1.3);
                bot.y += Math.sin(bot.targetAngle) * (bot.speed * 1.3);
                if (distanceToPlayer < bot.radius + single_global_state_object.player.radius + 5) {
                    bot.health = 0; 
                }
                break;
        }

        this.resolveObstacleCollisions(bot);
    },

    resolveObstacleCollisions(entity) {
        for (const wall of single_global_state_object.currentRoom.obstacles) {
            const satHit = SAT.checkCirclePolygon(entity.x, entity.y, entity.radius, wall);
            if (satHit) {
                entity.x -= satHit.normal.x * satHit.overlap;
                entity.y -= satHit.normal.y * satHit.overlap;
            }
        }
    }
};


function renderVisibilityPolygons(ctx, pX, pY, room) {
    if (!room || !room.segments) return;

    const endpoints = [];
    room.segments.forEach(seg => {
        endpoints.push(seg.p1, seg.p2);
    });

    const uniqueAngles = [];
    endpoints.forEach(p => {
        const angles = [
            Math.atan2(p.y - pY, p.x - pX),
            Math.atan2(p.y - pY, p.x - pX) - 0.0001,
            Math.atan2(p.y - pY, p.x - pX) + 0.0001
        ];
        angles.forEach(a => {
            if (!uniqueAngles.includes(a)) uniqueAngles.push(a);
        });
    });

    const intersects = [];
    uniqueAngles.forEach(angle => {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const ray = { a: { x: pX, y: pY }, b: { x: pX + dx, y: pY + dy } };

        let closestIntersect = null;
        room.segments.forEach(seg => {
            const intersect = getIntersection(ray, seg);
            if (!intersect) return;
            if (!closestIntersect || intersect.param < closestIntersect.param) {
                closestIntersect = intersect;
            }
        });

        if (closestIntersect) {
            closestIntersect.angle = angle;
            intersects.push(closestIntersect);
        }
    });

    intersects.sort((a, b) => a.angle - b.angle);

    ctx.save();
    ctx.fillStyle = "rgba(2, 3, 5, 0.98)"; 
    ctx.fillRect(0, 0, room.width, room.height);

    if (intersects.length > 0) {
        ctx.beginPath();
        ctx.moveTo(intersects[0].x, intersects[0].y);
        for (let i = 1; i < intersects.length; i++) {
            ctx.lineTo(intersects[i].x, intersects[i].y);
        }
        ctx.closePath();
        ctx.clip();
        ctx.fillStyle = "#05070b"; 
        ctx.fillRect(0, 0, room.width, room.height);
        
        ctx.strokeStyle = "#0d111a"; 
        ctx.lineWidth = 1;
        for (let x = 0; x < room.width; x += 40) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, room.height); ctx.stroke();
        }
        for (let y = 0; y < room.height; y += 40) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(room.width, y); ctx.stroke();
        }
    }
    ctx.restore();
}

function render_entities_and_update_state() {
    const s = single_global_state_object;
    if (!s.engineRunning || s.paused) return;

    const now = performance.now();

    if (s.player.speedBoostActive && now > s.player.speedBoostTimer) {
        s.player.speedBoostActive = false;
    }
    
    let currentMoveSpeed = s.player.speed;
    if (s.player.speedBoostActive) currentMoveSpeed *= 1.6;

    if (s.input.w) s.player.y -= currentMoveSpeed;
    if (s.input.s) s.player.y += currentMoveSpeed;
    if (s.input.a) s.player.x -= currentMoveSpeed;
    if (s.input.d) s.player.x += currentMoveSpeed;

    enemy_manager_singleton_controller_factory.resolveObstacleCollisions(s.player);
    
    window.player_position_x = s.player.x;
    window.player_position_y = s.player.y;

    if (s.input.clicked && now - s.player.lastFired > s.player.fireRate) {
        const pAngle = Math.atan2(s.input.mouseY - s.player.y, s.input.mouseX - s.player.x);
        if (s.player.hasSplitFire) {
            appendBullet(createBulletNode(s.player.x, s.player.y, Math.cos(pAngle - 0.15) * 8, Math.sin(pAngle - 0.15) * 8, false, s.player.damage));
            appendBullet(createBulletNode(s.player.x, s.player.y, Math.cos(pAngle + 0.15) * 8, Math.sin(pAngle + 0.15) * 8, false, s.player.damage));
        } else {
            appendBullet(createBulletNode(s.player.x, s.player.y, Math.cos(pAngle) * 9, Math.sin(pAngle) * 9, false, s.player.damage));
        }
        AudioSynth.play('laser');
        s.player.lastFired = now;
    }

    let bNode = s.bulletsHead;
    while (bNode !== null) {
        const nextNode = bNode.next; 
        
        bNode.x += bNode.vx;
        bNode.y += bNode.vy;

        let bulletDestroyed = false;

        for (const wall of s.currentRoom.obstacles) {
            const hit = SAT.checkCirclePolygon(bNode.x, bNode.y, bNode.radius, wall);
            if (hit) {
                if (bNode.bounces < bNode.maxBounces) {
                    bNode.bounces++;
                    bNode.x -= hit.normal.x * hit.overlap;
                    
                    const dotProd = bNode.vx * hit.normal.x + bNode.vy * hit.normal.y;
                    bNode.vx = bNode.vx - 2 * dotProd * hit.normal.x;
                    bNode.vy = bNode.vy - 2 * dotProd * hit.normal.y;
                    AudioSynth.play('hit');
                } else {
                    bulletDestroyed = true;
                }
                break;
            }
        }

        if (!bulletDestroyed) {
            if (bNode.isEnemy) {
                if (Math.hypot(s.player.x - bNode.x, s.player.y - bNode.y) < s.player.radius + bNode.radius) {
                    s.player.health -= bNode.damage;
                    AudioSynth.play('hit');
                    createSpatterParticles(bNode.x, bNode.y, '#ff3333');
                    bulletDestroyed = true;
                    if (s.player.health <= 0) terminateEngineRun(false);
                }
            } else {
                for (let i = s.enemies.length - 1; i >= 0; i--) {
                    const enemy = s.enemies[i];
                    if (Math.hypot(enemy.x - bNode.x, enemy.y - bNode.y) < enemy.radius + bNode.radius) {
                        enemy.health -= bNode.damage;
                        bulletDestroyed = true;
                        createSpatterParticles(bNode.x, bNode.y, '#4af626');
                        
                        if (enemy.health <= 0) {
                            if (enemy.type === 'EXPLOSIVE') {
                                AudioSynth.play('explosion');
                                createSpatterParticles(enemy.x, enemy.y, '#ffaa00', 30);
                                if (Math.hypot(s.player.x - enemy.x, s.player.y - enemy.y) < 90) {
                                    s.player.health -= 25;
                                    if (s.player.health <= 0) terminateEngineRun(false);
                                }
                            }
                            
                            if (Math.random() > 0.4) {
                                s.lootDrops.push({ x: enemy.x, y: enemy.y, amt: 10 + Math.floor(Math.random() * 15) });
                            }
                            s.enemies.splice(i, 1);
                            s.score += 100;
                            s.credits += 10;
                        }
                        break;
                    }
                }
            }
        }

        if (bulletDestroyed) {
            removeBulletNode(bNode);
        }
        bNode = nextNode;
    }

    for (const enemy of s.enemies) {
        enemy_manager_singleton_controller_factory.updateAI(enemy, s.player.x, s.player.y, now);
    }

    if (s.enemies.length === 0 && !s.currentRoom.door.open) {
        s.currentRoom.door.open = true;
        AudioSynth.play('pickup');
    }

    if (s.currentRoom.door.open && Math.hypot(s.player.x - s.currentRoom.door.x, s.player.y - s.currentRoom.door.y) < 30) {
        advanceSectorLevel();
    }

    for (let i = s.lootDrops.length - 1; i >= 0; i--) {
        if (Math.hypot(s.player.x - s.lootDrops[i].x, s.player.y - s.lootDrops[i].y) < s.player.radius + 10) {
            s.credits += s.lootDrops[i].amt;
            AudioSynth.play('pickup');
            s.lootDrops.splice(i, 1);
        }
    }

    for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x += p.vx; p.y += p.vy;
        p.alpha -= 0.03;
        if (p.alpha <= 0) s.particles.splice(i, 1);
    }

    renderGraphicsViewport(s.ctx, s);
    save_game_state_every_frame();
}


function renderGraphicsViewport(ctx, s) {
    ctx.clearRect(0, 0, s.currentRoom.width, s.currentRoom.height);

    renderVisibilityPolygons(ctx, s.player.x, s.player.y, s.currentRoom);
    ctx.fillStyle = '#1c3519';
    ctx.strokeStyle = '#4af626';
    ctx.lineWidth = 1.5;
    for (const wall of s.currentRoom.obstacles) {
        ctx.beginPath();
        ctx.moveTo(wall[0].x, wall[0].y);
        for (let i = 1; i < wall.length; i++) ctx.lineTo(wall[i].x, wall[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    const door = s.currentRoom.door;
    ctx.fillStyle = door.open ? 'rgba(74, 246, 38, 0.4)' : 'rgba(230, 30, 30, 0.6)';
    ctx.strokeStyle = door.open ? '#4af626' : '#e61e1e';
    ctx.fillRect(door.x, door.y, door.width, door.height);
    ctx.strokeRect(door.x, door.y, door.width, door.height);

    ctx.fillStyle = '#ffcc00';
    for (const drop of s.lootDrops) {
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    let bNode = s.bulletsHead;
    while (bNode !== null) {
        ctx.fillStyle = bNode.isEnemy ? '#e61e1e' : '#4af626';
        ctx.beginPath();
        ctx.arc(bNode.x, bNode.y, bNode.radius, 0, Math.PI * 2);
        ctx.fill();
        bNode = bNode.next;
    }

    for (const enemy of s.enemies) {
        if (enemy.type === 'HUNTER') ctx.fillStyle = '#22aa22';
        else if (enemy.type === 'SNIPER') ctx.fillStyle = '#ddaa00';
        else if (enemy.type === 'DASH') ctx.fillStyle = '#8822bb';
        else if (enemy.type === 'EXPLOSIVE') ctx.fillStyle = '#cc2222';

        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(enemy.x, enemy.y);
        ctx.lineTo(enemy.x + Math.cos(enemy.targetAngle) * 20, enemy.y + Math.sin(enemy.targetAngle) * 20);
        ctx.stroke();

        if (enemy.type === 'SNIPER' && enemy.alertStatus && enemy.laserLock > 0) {
            ctx.strokeStyle = `rgba(255, 0, 0, ${enemy.laserLock})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(enemy.x, enemy.y);
            ctx.lineTo(s.player.x, s.player.y);
            ctx.stroke();
        }
    }

    for (const p of s.particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1.0; 

    ctx.fillStyle = s.player.speedBoostActive ? '#99ffaa' : '#4af626';
    ctx.beginPath();
    ctx.arc(s.player.x, s.player.y, s.player.radius, 0, Math.PI * 2);
    ctx.fill();

    const targetAimAngle = Math.atan2(s.input.mouseY - s.player.y, s.input.mouseX - s.player.x);
    ctx.strokeStyle = 'rgba(74, 246, 38, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.player.x, s.player.y);
    ctx.lineTo(s.player.x + Math.cos(targetAimAngle) * 25, s.player.y + Math.sin(targetAimAngle) * 25);
    ctx.stroke();

    document.getElementById('hp-fill').style.width = `${(s.player.health / s.player.maxHealth) * 100}%`;
    document.getElementById('hud-sector').innerText = s.currentSectorIndex;
    document.getElementById('hud-credits').innerText = s.credits;
    document.getElementById('hud-score').innerText = s.score;
    document.getElementById('hud-weapon').innerText = s.player.hasSplitFire ? "SPLIT-ARRAY FLUX BLASTER" : "STANDARDIZED BLASTER";
}

function createSpatterParticles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 1 + Math.random() * 3;
        single_global_state_object.particles.push({
            x: x, y: y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            color: color, alpha: 1.0,
            size: 2 + Math.random() * 3
        });
    }
}

function save_game_state_every_frame() {}

function main_game_loop() {
    render_entities_and_update_state();
    requestAnimationFrame(main_game_loop);
}

function startGame() {
    AudioSynth.init();
    const s = single_global_state_object;
    
    s.score = 0; s.credits = 0; s.currentSectorIndex = 1;
    s.player.health = 100; s.player.x = 80; s.player.y = 300;
    s.player.hasSplitFire = false; s.player.speedBoostActive = false;
    s.bulletsHead = null; s.particles = []; s.lootDrops = [];

    s.currentRoom = generateProceduralRoom(s.currentSectorIndex);
    enemy_manager_singleton_controller_factory.spawnPool(s.currentRoom, s.currentSectorIndex);

    s.gameState = 'PLAYING';
    s.engineRunning = true; s.paused = false;
    
    document.getElementById('screen-overlay').style.display = 'none';
    document.getElementById('shop-modal').style.display = 'none';
}

function advanceSectorLevel() {
    const s = single_global_state_object;
    s.currentSectorIndex++;
    if (s.currentSectorIndex > 5) {
        terminateEngineRun(true);
        return;
    }
    s.player.x = 80; s.player.y = 300;
    s.bulletsHead = null; s.particles = []; s.lootDrops = [];
    s.currentRoom = generateProceduralRoom(s.currentSectorIndex);
    enemy_manager_singleton_controller_factory.spawnPool(s.currentRoom, s.currentSectorIndex);
}

function toggleEnginePause() {
    const s = single_global_state_object;
    if (s.gameState !== 'PLAYING') return;
    
    s.paused = !s.paused;
    const shop = document.getElementById('shop-modal');
    if (s.paused) {
        shop.style.display = 'block';
    } else {
        shop.style.display = 'none';
    }
}

function buyUpgrade(type, cost) {
    const s = single_global_state_object;
    if (s.credits < cost) return;
    
    s.credits -= cost;
    if (type === 'heal') {
        s.player.health = Math.min(s.player.maxHealth, s.player.health + 30);
    } else if (type === 'speed') {
        s.player.speedBoostActive = true;
        s.player.speedBoostTimer = performance.now() + 15000; 
    } else if (type === 'weapon') {
        s.player.hasSplitFire = true;
    } else if (type === 'damage') {
        s.player.damage += 15;
    }
    AudioSynth.play('pickup');
}

function terminateEngineRun(isWinResult) {
    const s = single_global_state_object;
    s.engineRunning = false;
    s.gameState = isWinResult ? 'WIN' : 'GAMEOVER';
    
    const overlay = document.getElementById('screen-overlay');
    const title = document.getElementById('overlay-title');
    const desc = document.getElementById('overlay-desc');
    const btn = document.getElementById('action-btn');

    overlay.style.display = 'flex';
    document.getElementById('shop-modal').style.display = 'none';

    if (isWinResult) {
        title.innerText = "SECTOR PURGED";
        title.style.color = "#4af626";
        desc.innerText = `System purged. Final Telemetry Score Vector: ${s.score}`;
        btn.innerText = "RE-INITIALIZE SIMULATION";
    } else {
        title.innerText = "HARDWARE TERMINATED";
        title.style.color = "#ff3333";
        desc.innerText = `System failure. Core lost on Sector ${s.currentSectorIndex}. Score: ${s.score}`;
        btn.innerText = "REBOOT MATRIX";
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    single_global_state_object.canvas = canvas;
    single_global_state_object.ctx = canvas.getContext('2d');

    window.addEventListener('keydown', e => {
        if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') single_global_state_object.input.w = true;
        if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') single_global_state_object.input.s = true;
        if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') single_global_state_object.input.a = true;
        if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') single_global_state_object.input.d = true;
        if (e.key === 'p' || e.key === 'P') toggleEnginePause();
    });

    window.addEventListener('keyup', e => {
        if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') single_global_state_object.input.w = false;
        if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') single_global_state_object.input.s = false;
        if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') single_global_state_object.input.a = false;
        if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') single_global_state_object.input.d = false;
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
