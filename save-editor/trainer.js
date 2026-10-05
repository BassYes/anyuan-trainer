#!/usr/bin/env node
'use strict';

/**
 * 黯渊崛起 Demo — 存档修改器 (方案 A)
 * ============================================================
 * RPG Maker MZ 存档直接读写工具。
 *
 * 存档格式(已实测无损往返):
 *   JSON -> zlib deflate(level 1) -> 二进制串(latin1) -> UTF-8 写盘
 * 与游戏 StorageManager (rmmz_managers.js) 完全兼容。
 *
 * 用法:
 *   node trainer.js                     交互菜单
 *   node trainer.js info                查看信息
 *   node trainer.js gold 9999999        设置金币
 *   node trainer.js addgold 100000      增加金币
 *   node trainer.js maxlevel            队伍全员满级
 *   node trainer.js level <ID/名字> <等级>
 *   node trainer.js fullhp              满血满蓝(队伍)
 *   node trainer.js boost [N=9999]      属性拉满(+N 全属性)
 *   node trainer.js allitems [N=99]     全物品/武器/防具 x N
 *   node trainer.js item   <名字/ID> [N=99]
 *   node trainer.js weapon <名字/ID> [N=99]
 *   node trainer.js armor  <名字/ID> [N=99]
 *   node trainer.js sect 999999         门派贡献
 *   node trainer.js var   <序号> <值>     修改变量(任务进度)
 *   node trainer.js switch <序号> <true|false>
 *   node trainer.js backup              备份存档
 *   node trainer.js restore             恢复备份
 *
 * 可选参数:  --game <游戏目录>   --save <存档名, 如 file1>
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------- 配置 ----------------
const DEFAULT_GAME_DIR = 'E:\\SteamLibrary\\steamapps\\common\\暗渊崛起 Demo';
const DEFAULT_SAVE_NAME = 'file1.rmmzsave';
const BOOST_DEFAULT = 9999;
const ALLITEM_DEFAULT = 99;

// ---------------- 命令行参数 ----------------
function parseArgs(argv) {
    const opts = { gameDir: DEFAULT_GAME_DIR, saveName: DEFAULT_SAVE_NAME, cmd: null, args: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--game') opts.gameDir = argv[++i];
        else if (a === '--save') opts.saveName = argv[++i];
        else if (opts.cmd === null) opts.cmd = a;
        else opts.args.push(a);
    }
    return opts;
}

// ---------------- 存档编解码 ----------------
function loadSave(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');          // 与游戏 fsReadFile 一致
    const buf = Buffer.from(text, 'latin1');                 // 还原二进制字节
    const json = zlib.inflateSync(buf).toString('utf8');     // 解压
    return JSON.parse(json);
}

function encodeSave(obj) {
    const json = JSON.stringify(obj);
    const buf = zlib.deflateSync(Buffer.from(json, 'utf8'), { level: 1 });
    return buf.toString('latin1');                           // 二进制串
}

function writeSave(filePath, obj) {
    fs.writeFileSync(filePath, encodeSave(obj), 'utf8');     // 与游戏 fsWriteFile 一致(utf8)
}

// ---------------- 游戏数据加载 ----------------
const _dataCache = {};
function loadData(gameDir, name) {
    const key = gameDir + '/' + name;
    if (!_dataCache[key]) {
        _dataCache[key] = JSON.parse(
            fs.readFileSync(path.join(gameDir, 'data', name + '.json'), 'utf8')
        );
    }
    return _dataCache[key];
}

function buildIdMap(arr) {
    const m = {};
    if (Array.isArray(arr)) {
        arr.forEach(e => { if (e && e.id) m[e.id] = e; });
    }
    return m;
}

// ---------------- 插件参数 / 作弊数据 ----------------
function loadPluginParams(gameDir) {
    const file = path.join(gameDir, 'js', 'plugins.js');
    if (!fs.existsSync(file)) return {};
    const txt = fs.readFileSync(file, 'utf8');
    const m = txt.match(/var\s+\$plugins\s*=\s*(\[[\s\S]*\]);/);
    if (!m) return {};
    let arr;
    try { arr = JSON.parse(m[1]); } catch (e) { return {}; }
    const map = {};
    arr.forEach(p => { if (p && p.name) map[p.name] = p.parameters || {}; });
    return map;
}

function parseStructList(raw, idKey) {
    if (!raw) return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { return []; }
    const out = [];
    arr.forEach(entry => {
        let obj = entry;
        if (typeof entry === 'string') { try { obj = JSON.parse(entry); } catch (e) { return; } }
        const id = Number(obj && obj[idKey]);
        if (id > 0) out.push(id);
    });
    return [...new Set(out)];
}

function parseNumberList(raw) {
    if (!raw) return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { return []; }
    return [...new Set(arr.map(Number).filter(n => n > 0))];
}

// 解析 [ "{...}", ... ] 形式的参数为对象数组
function parseStructObjects(raw) {
    if (!raw) return [];
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { return []; }
    return arr.map(entry => {
        if (typeof entry === 'string') { try { return JSON.parse(entry); } catch (e) { return null; } }
        return entry;
    }).filter(Boolean);
}

// 任务组 tasks 字段是 "[\"{...}\"]" 双重编码
function taskIdsOf(rawTasks) {
    try { return JSON.parse(rawTasks).map(t => String(JSON.parse(t).taskId)); } catch (e) { return []; }
}

// 汇总所有作弊所需的 ID 列表与配置(从 plugins.js 参数提取)
function buildCheatData(gameDir, gd) {
    const pp = loadPluginParams(gameDir);
    const p = n => pp[n] || {};
    const petActorIds = parseStructList(p('BZ_PetSystem').petData, 'actorId');
    // 全职业可学技能并集
    const learnSet = new Set();
    Object.values(gd.classesMap).forEach(c => (c.learnings || []).forEach(l => {
        if (l.skillId > 0 && gd.skillsMap[l.skillId]) learnSet.add(l.skillId);
    }));
    // 武器精通配置
    const wmBase = Number(p('BZ_WeaponMastery').baseExp) || 100;
    const wmCurve = Number(p('BZ_WeaponMastery').expCurve) || 1.5;
    const wmMax = Number(p('BZ_WeaponMastery').maxLevel) || 99;
    const wmExclude = parseNumberList(p('BZ_WeaponMastery').excludeWtypeIds);
    const weaponTypes = (gd.system.weaponTypes || []).map((_, i) => i).filter(i => i > 0 && !wmExclude.includes(i));
    // 礼包码
    const giftCodes = parseStructObjects(p('BZ_GiftCode').giftCodes)
        .map(o => ({ code: String(o.code || ''), name: String(o.name || '') }))
        .filter(x => x.code);
    // 门派日常任务
    const sectGroups = parseStructObjects(p('BZ_SectTaskGroupManager').groups)
        .map(o => ({ groupId: String(o.groupId || ''), taskIds: taskIdsOf(o.tasks) }))
        .filter(g => g.groupId);
    // 冒险者任务列表
    const taskLists = parseStructObjects(p('BZ_TaskListManager').taskLists)
        .map(o => ({
            listId: String(o.listId || ''),
            listName: String(o.listName || ''),
            scoreVarId: Number(o.scoreVarId || 0),
            taskIds: taskIdsOf(o.tasks),
        }))
        .filter(l => l.listId);
    // 可镶嵌宝石
    const gems = Object.values(gd.itemsMap)
        .filter(it => it.note && it.note.includes('<可镶嵌>'))
        .map(it => {
            const m = it.note.match(/<宝石效果:([^>]+)>/);
            return { id: it.id, name: it.name, effect: m ? m[1] : '' };
        });
    return {
        monsterIds: parseNumberList(p('BZ_MonsterEncyclopedia').enemyList),
        skillEncyIds: parseStructList(p('BZ_SkillEncyclopedia').skillList, 'skillId'),
        stateEncyIds: parseStructList(p('BZ_StateEncyclopedia').stateList, 'stateId'),
        weaponEncyIds: parseStructList(p('BZ_EquipEncyclopedia').weaponList, 'weaponId'),
        armorEncyIds: parseStructList(p('BZ_EquipEncyclopedia').armorList, 'armorId'),
        petActorIds,
        maxPets: Number(p('BZ_PetSystem').maxPets) || 40,
        learnableSkillIds: [...learnSet].sort((a, b) => a - b),
        skillMasteryMax: Number(p('BZ_SkillMastery').maxMasteryLevel) || 10,
        weaponMasteryTypes: weaponTypes,
        weaponMasteryMax: wmMax,
        weaponMasteryMaxExp: Math.floor(wmBase * Math.pow(wmMax, wmCurve)),
        awakenMax: 100,
        giftCodes,
        sectGroups,
        taskLists,
        gems,
    };
}

// ---------------- 工具函数 ----------------
function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
}

// 操作返回值: 字符串=已变更; {text, changed:false}=未变更(不写盘)
function noChange(text) { return { text, changed: false }; }
function textOf(m) { return m && typeof m === 'object' ? m.text : m; }
function changedOf(m) { return !(m && typeof m === 'object' && m.changed === false); }

function fmtTime(sec) {
    sec = Math.floor(sec || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// RMMZ 升级经验公式 (rmmz_objects.js Game_Actor#expForLevel)
function expForLevel(level, expParams) {
    const basis = expParams[0];
    const extra = expParams[1];
    const acc_a = expParams[2];
    const acc_b = expParams[3];
    return Math.round(
        (basis * Math.pow(level - 1, 0.9 + acc_a / 250) * level * (level + 1)) /
            (6 + Math.pow(level, 2) / 50 / acc_b) +
            (level - 1) * extra
    );
}

// ---- 角色参数计算 (完全复刻游戏 rmmz_objects.js 公式) ----
// param = round((paramBase + _paramPlus + Σ装备params) * paramRate * paramBuffRate)
const TRAIT_PARAM = 21;

// 装备 Game_Item -> 数据库条目
function equipItemOf(gd, gi) {
    if (!gi || !gi._dataClass) return null;
    const id = gi._itemId;
    if (gi._dataClass === 'weapon') return gd.weaponsMap[id] || null;
    if (gi._dataClass === 'armor') return gd.armorsMap[id] || null;
    if (gi._dataClass === 'item') return gd.itemsMap[id] || null;
    return null;
}

// 参与特性计算的对象: 状态 + 角色 + 职业 + 装备 (对应 traitObjects())
function traitObjects(gd, actor) {
    const objs = [];
    (actor._states || []).forEach(s => { if (gd.statesMap[s]) objs.push(gd.statesMap[s]); });
    const ad = gd.actorsMap[actor._actorId];
    if (ad) objs.push(ad);
    const cd = gd.classesMap[actor._classId];
    if (cd) objs.push(cd);
    (actor._equips || []).forEach(g => { const it = equipItemOf(gd, g); if (it) objs.push(it); });
    return objs;
}

// traitsPi: 同 code/dataId 的特性数值连乘 (无则 1)
function traitsPi(gd, actor, code, dataId) {
    let v = 1;
    for (const ob of traitObjects(gd, actor)) {
        for (const t of (ob.traits || [])) {
            if (t.code === code && t.dataId === dataId) v *= t.value;
        }
    }
    return v;
}

function actorParam(gd, actor, pid) {
    const cd = gd.classesMap[actor._classId];
    const lvl = Math.min(Math.max(actor._level || 1, 1), 99);
    let basePlus = cd && cd.params && cd.params[pid] ? (cd.params[pid][lvl] || 0) : 0;
    basePlus += (actor._paramPlus && actor._paramPlus[pid]) || 0;
    (actor._equips || []).forEach(g => {
        const it = equipItemOf(gd, g);
        if (it && it.params) basePlus += it.params[pid] || 0;
    });
    const rate = traitsPi(gd, actor, TRAIT_PARAM, pid);
    const buffRate = ((actor._buffs && actor._buffs[pid]) || 0) * 0.25 + 1.0;
    const minV = pid === 0 ? 1 : 0;
    return Math.round(Math.max(minV, basePlus * rate * buffRate));
}

function actorMaxHp(gd, actor) { return actorParam(gd, actor, 0); }
function actorMaxMp(gd, actor) { return actorParam(gd, actor, 1); }

function actorDisplay(gd, actor, id) {
    const cls = gd.classesMap[actor._classId];
    return {
        id,
        name: actor._name || `角色#${id}`,
        cls: cls ? cls.name : '?',
        level: actor._level,
        hp: actor._hp, mhp: actorMaxHp(gd, actor),
        mp: actor._mp, mmp: actorMaxMp(gd, actor),
        atk: actorParam(gd, actor, 2),
        def: actorParam(gd, actor, 3),
        agi: actorParam(gd, actor, 6),
        luk: actorParam(gd, actor, 7),
    };
}

// 按 ID 或名字查找数据条目
function findEntry(map, query) {
    if (/^\d+$/.test(String(query))) {
        const id = parseInt(query, 10);
        if (map[id]) return [map[id]];
    }
    const q = String(query).toLowerCase();
    const out = [];
    for (const id of Object.keys(map)) {
        const e = map[id];
        if (e.name && e.name.toLowerCase().includes(q)) out.push(e);
    }
    return out;
}

function isPlaceholder(entry) {
    if (!entry || !entry.name) return true;
    if (entry.name.startsWith('-----')) return true;
    return false;
}

// ---------------- 操作实现 ----------------
// 每个操作修改 state.obj, 返回打印用的信息

function opInfo(state) {
    const o = state.obj;
    const gd = state.gameData;
    const lines = [];
    const sys = o.system || {};
    lines.push(`存档文件 : ${state.savePath}`);
    lines.push(`游戏时长 : ${fmtTime((sys._framesOnSave || 0) / 60)}   (存档次数 ${sys._saveCount || 0})`);
    lines.push(`金币     : ${fmt(o.party._gold)}`);
    lines.push(`步数     : ${fmt(o.party._steps)}`);
    lines.push(`门派贡献 : ${fmt(o.party._sectContribution)}`);
    lines.push(`宠物数   : ${(o.party._mkPetRoster || []).length}`);
    lines.push('');
    lines.push('— 队伍成员 —');
    const party = o.party._actors || [];
    party.forEach(aid => {
        const a = o.actors._data[aid];
        if (!a) { lines.push(`  #${aid} (数据缺失)`); return; }
        const d = actorDisplay(gd, a, aid);
        lines.push(`  #${d.id} ${d.name} [${d.cls}] Lv${d.level} | HP ${d.hp}/${d.mhp} MP ${d.mp}/${d.mmp} | 攻${d.atk} 防${d.def} 敏${d.agi} 运${d.luk}`);
    });
    lines.push('');
    lines.push('— 全部角色 —');
    o.actors._data.forEach((a, id) => {
        if (!a) return;
        const inParty = party.includes(id);
        const d = actorDisplay(gd, a, id);
        lines.push(`  ${inParty ? '★' : ' '} #${d.id} ${d.name} [${d.cls}] Lv${d.level}/${gd.actorsMap[id] ? gd.actorsMap[id].maxLevel : '?'} | HP ${d.hp}/${d.mhp} MP ${d.mp}/${d.mmp} | 攻${d.atk} 防${d.def} 敏${d.agi} 运${d.luk}`);
    });
    lines.push('');
    lines.push(`— 背包 —`);
    lines.push(`  物品 ${Object.keys(o.party._items || {}).length} 种 | 武器 ${Object.keys(o.party._weapons || {}).length} 种 | 防具 ${Object.keys(o.party._armors || {}).length} 种`);
    lines.push('');
    lines.push('— 非零变量(任务进度等) —');
    const vnames = gd.system.variables || [];
    const vdata = (o.variables && o.variables._data) || [];
    let shown = 0;
    vdata.forEach((v, i) => {
        if (v !== 0 && v !== null && v !== undefined && v !== '') {
            lines.push(`  变量[${i}] ${vnames[i] ? '「' + vnames[i] + '」' : ''} = ${JSON.stringify(v)}`);
            shown++;
        }
    });
    if (!shown) lines.push('  (无)');
    return lines.join('\n');
}

function opGold(state, value) {
    state.obj.party._gold = value;
    return `金币已设置为 ${fmt(value)}`;
}

function opAddGold(state, value) {
    state.obj.party._gold = (state.obj.party._gold || 0) + value;
    return `金币 +${fmt(value)}，当前 ${fmt(state.obj.party._gold)}`;
}

function opMaxLevel(state) {
    const o = state.obj;
    const gd = state.gameData;
    const party = o.party._actors || [];
    const done = [];
    party.forEach(aid => {
        const a = o.actors._data[aid];
        if (!a) return;
        const max = (gd.actorsMap[aid] && gd.actorsMap[aid].maxLevel) || 99;
        const cls = gd.classesMap[a._classId];
        a._level = max;
        if (cls && cls.expParams) {
            a._exp = a._exp || {};
            a._exp[String(a._classId)] = expForLevel(max, cls.expParams);
        }
        clampHpMp(gd, a);
        done.push(`${a._name}(→Lv${max})`);
    });
    return `已满级: ${done.join(', ')}`;
}

function opLevel(state, query, level) {
    const o = state.obj;
    const gd = state.gameData;
    const actors = o.actors._data;
    const party = o.party._actors || [];
    let target = null;
    if (/^\d+$/.test(String(query))) {
        const id = parseInt(query, 10);
        if (actors[id]) target = { id, actor: actors[id] };
    } else {
        for (let i = 1; i < actors.length; i++) {
            const a = actors[i];
            if (a && a._name && a._name.includes(String(query))) {
                if (target) { return noChange(`名字「${query}」匹配到多个角色, 请改用 ID 指定`); }
                target = { id: i, actor: a };
            }
        }
    }
    if (!target) return noChange(`未找到角色「${query}」`);
    const max = (gd.actorsMap[target.id] && gd.actorsMap[target.id].maxLevel) || 99;
    level = Math.min(Math.max(level, 1), max);
    const cls = gd.classesMap[target.actor._classId];
    target.actor._level = level;
    if (cls && cls.expParams) {
        target.actor._exp = target.actor._exp || {};
        target.actor._exp[String(target.actor._classId)] = expForLevel(level, cls.expParams);
    }
    clampHpMp(gd, target.actor);
    const note = party.includes(target.id) ? '(在队伍中)' : '';
    return `角色 #${target.id} ${target.actor._name} 等级已设为 Lv${level} ${note}`;
}

function clampHpMp(gd, actor) {
    const mhp = actorMaxHp(gd, actor);
    const mmp = actorMaxMp(gd, actor);
    if (actor._hp > mhp) actor._hp = mhp;
    if (actor._mp > mmp) actor._mp = mmp;
    if (actor._hp < 1) actor._hp = 1;
}

function opFullHpMp(state) {
    const o = state.obj;
    const gd = state.gameData;
    const party = o.party._actors || [];
    const done = [];
    party.forEach(aid => {
        const a = o.actors._data[aid];
        if (!a) return;
        a._hp = actorMaxHp(gd, a);
        a._mp = actorMaxMp(gd, a);
        done.push(`${a._name}(${a._hp}/${a._mp})`);
    });
    return `已满血满蓝: ${done.join(', ')}`;
}

function opBoost(state, n) {
    const o = state.obj;
    const gd = state.gameData;
    const party = o.party._actors || [];
    const done = [];
    party.forEach(aid => {
        const a = o.actors._data[aid];
        if (!a) return;
        a._paramPlus = a._paramPlus || [0, 0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 8; i++) a._paramPlus[i] = (a._paramPlus[i] || 0) + n;
        a._hp = actorMaxHp(gd, a);
        a._mp = actorMaxMp(gd, a);
        done.push(a._name);
    });
    return `已为队伍全员 +${fmt(n)} 全属性并回满: ${done.join(', ')}`;
}

function opAllItems(state, count) {
    const o = state.obj;
    const gd = state.gameData;
    let ni = 0, nw = 0, na = 0;
    o.party._items = o.party._items || {};
    o.party._weapons = o.party._weapons || {};
    o.party._armors = o.party._armors || {};
    Object.values(gd.itemsMap).forEach(e => {
        if (isPlaceholder(e)) return;
        o.party._items[String(e.id)] = count;
        ni++;
    });
    Object.values(gd.weaponsMap).forEach(e => {
        if (isPlaceholder(e)) return;
        o.party._weapons[String(e.id)] = count;
        nw++;
    });
    Object.values(gd.armorsMap).forEach(e => {
        if (isPlaceholder(e)) return;
        o.party._armors[String(e.id)] = count;
        na++;
    });
    return `已添加全物品 x${count}: 物品 ${ni} 种 / 武器 ${nw} 种 / 防具 ${na} 种`;
}

function opAddItem(state, kind, query, count) {
    const o = state.obj;
    const gd = state.gameData;
    const map = kind === 'item' ? gd.itemsMap : kind === 'weapon' ? gd.weaponsMap : gd.armorsMap;
    const key = kind === 'item' ? '_items' : kind === 'weapon' ? '_weapons' : '_armors';
    const found = findEntry(map, query).filter(e => !isPlaceholder(e));
    if (found.length === 0) return noChange(`未找到${kind === 'item' ? '物品' : kind === 'weapon' ? '武器' : '防具'}「${query}」`);
    if (found.length > 1) {
        const list = found.slice(0, 10).map(e => `  #${e.id} ${e.name}`).join('\n');
        return noChange(`「${query}」匹配多个, 请用 ID 指定:\n${list}`);
    }
    const e = found[0];
    o.party[key] = o.party[key] || {};
    if (count <= 0) delete o.party[key][String(e.id)];
    else o.party[key][String(e.id)] = count;
    const cn = kind === 'item' ? '物品' : kind === 'weapon' ? '武器' : '防具';
    return count <= 0 ? `已移除${cn} #${e.id} ${e.name}` : `已添加${cn} #${e.id} ${e.name} x${count}`;
}

function opSect(state, value) {
    state.obj.party._sectContribution = value;
    return `门派贡献已设置为 ${fmt(value)}`;
}

function opVar(state, index, value) {
    const o = state.obj;
    const name = (state.gameData.system.variables || [])[index];
    o.variables._data = o.variables._data || [];
    o.variables._data[index] = value;
    return `变量[${index}]${name ? '「' + name + '」' : ''} 已设为 ${JSON.stringify(value)}`;
}

function opSwitch(state, index, value) {
    const o = state.obj;
    const name = (state.gameData.system.switches || [])[index];
    o.switches._data = o.switches._data || [];
    o.switches._data[index] = !!value;
    return `开关[${index}]${name ? '「' + name + '」' : ''} 已设为 ${!!value}`;
}

// ---------------- 扩展功能: 图鉴/精通/技能/宠物/任务 ----------------
function partyActors(state) {
    const o = state.obj;
    return (o.party._actors || [])
        .map(id => ({ id, actor: o.actors._data[id] }))
        .filter(x => x.actor);
}

function petActorIdOf(entry) {
    if (typeof entry === 'number') return entry;
    if (entry && typeof entry === 'object') return entry._actorId;
    return null;
}

function opUnlockAll(state) {
    const o = state.obj;
    const ch = state.gameData.cheats;
    const S = o.system;
    const n = { monster: 0, skill: 0, state: 0, weapon: 0, armor: 0, pet: 0 };
    S._encyclopediaData = S._encyclopediaData || {};
    ch.monsterIds.forEach(id => { if (!S._encyclopediaData[id]) { S._encyclopediaData[id] = true; n.monster++; } });
    S._skillEncyUnlocked = S._skillEncyUnlocked || {};
    ch.skillEncyIds.forEach(id => { if (!S._skillEncyUnlocked[id]) { S._skillEncyUnlocked[id] = true; n.skill++; } });
    S._stateEncyUnlocked = S._stateEncyUnlocked || {};
    ch.stateEncyIds.forEach(id => { if (!S._stateEncyUnlocked[id]) { S._stateEncyUnlocked[id] = true; n.state++; } });
    S._equipEncyUnlocked = S._equipEncyUnlocked || {};
    ch.weaponEncyIds.forEach(id => { const k = 'weapon_' + id; if (!S._equipEncyUnlocked[k]) { S._equipEncyUnlocked[k] = true; n.weapon++; } });
    ch.armorEncyIds.forEach(id => { const k = 'armor_' + id; if (!S._equipEncyUnlocked[k]) { S._equipEncyUnlocked[k] = true; n.armor++; } });
    S._bzPetEncyData = S._bzPetEncyData || {};
    ch.petActorIds.forEach(id => { if (!S._bzPetEncyData[id]) { S._bzPetEncyData[id] = true; n.pet++; } });
    return `图鉴全解锁: 怪物+${n.monster} 技能+${n.skill} 状态+${n.state} 武器+${n.weapon} 防具+${n.armor} 宠物+${n.pet}`;
}

function opMastery(state) {
    const ch = state.gameData.cheats;
    let wt = 0, sk = 0;
    partyActors(state).forEach(({ actor }) => {
        actor._weaponMastery = actor._weaponMastery || {};
        ch.weaponMasteryTypes.forEach(t => { actor._weaponMastery[String(t)] = ch.weaponMasteryMaxExp; wt++; });
        actor._skillMastery = actor._skillMastery || {};
        (actor._skills || []).forEach(sid => {
            actor._skillMastery[String(sid)] = { level: ch.skillMasteryMax, exp: 0 };
            sk++;
        });
    });
    return `精通拉满: 武器类型 ${ch.weaponMasteryTypes.length} 类(Lv${ch.weaponMasteryMax})、技能 ${sk} 个(Lv${ch.skillMasteryMax})`;
}

function opLearnAll(state) {
    const ch = state.gameData.cheats;
    let total = 0;
    const per = [];
    partyActors(state).forEach(({ actor }) => {
        actor._skills = actor._skills || [];
        let added = 0;
        ch.learnableSkillIds.forEach(sid => {
            if (!actor._skills.includes(sid)) { actor._skills.push(sid); added++; }
        });
        actor._skills.sort((x, y) => x - y);   // 与游戏 learnSkill 保持一致
        total += added;
        per.push(`${actor._name}+${added}`);
    });
    return `学会全部职业技能(共 ${ch.learnableSkillIds.length} 个): ${per.join(', ')} (新增 ${total} 个)`;
}

function opPets(state, mode) {
    const o = state.obj;
    const ch = state.gameData.cheats;
    // 解锁宠物图鉴
    o.system._bzPetEncyData = o.system._bzPetEncyData || {};
    let ency = 0;
    ch.petActorIds.forEach(id => { if (!o.system._bzPetEncyData[id]) { o.system._bzPetEncyData[id] = true; ency++; } });
    if (mode === 'unlock') {
        return `宠物图鉴解锁 +${ency} (共 ${ch.petActorIds.length} 种)`;
    }
    o.party._mkPetRoster = o.party._mkPetRoster || [];
    const have = new Set(o.party._mkPetRoster.map(petActorIdOf));
    let added = 0;
    for (const id of ch.petActorIds) {
        if (o.party._mkPetRoster.length >= ch.maxPets) break;
        if (have.has(id)) continue;
        o.party._mkPetRoster.push(id);   // 数字格式, 游戏读档时自动构建实例
        added++;
    }
    if (o.party._mkActivePetIndex == null || o.party._mkActivePetIndex < 0) {
        o.party._mkActivePetIndex = 0;
    }
    return `已加入全部宠物 ${added} 只 (当前 ${o.party._mkPetRoster.length}/${ch.maxPets}, 出战设为第1只) + 图鉴+${ency}`;
}

function opQuests(state) {
    const q = state.obj.system._quests;
    if (!q) return noChange('该存档没有任务数据');
    q.known = q.known || [];
    q.completed = q.completed || [];
    q.objectives = q.objectives || {};
    q.objectivesCompleted = q.objectivesCompleted || {};
    q.rewards = q.rewards || {};
    q.rewardsClaimed = q.rewardsClaimed || {};
    let done = 0;
    q.known.forEach(key => {
        if (!q.completed.includes(key)) { q.completed.push(key); done++; }
        q.objectivesCompleted[key] = (q.objectives[key] || []).slice();
        q.rewardsClaimed[key] = (q.rewards[key] || []).slice();
    });
    return `任务日志: 已把 ${q.known.length} 个已知任务标记完成(本次新增 ${done})；注意这只是日志状态，不会发放奖励`;
}

function opShopLimit(state) {
    const o = state.obj;
    const n = Object.keys(o.system._bzShopPurchaseLimitCounts || {}).length;
    o.system._bzShopPurchaseLimitCounts = {};
    return `已清除商店限购记录 (${n} 条)`;
}

function opUnlockEquip(state) {
    const o = state.obj;
    const n = Object.keys(o.system._lockedEquips || {}).length;
    o.system._lockedEquips = {};
    return `已清除装备锁定 (${n} 条)`;
}

function opClearNew(state) {
    const o = state.obj;
    const n = (o.party._newItemsList || []).length;
    o.party._newItemsList = [];
    return `已清除"新物品"标记 (${n} 条)`;
}

function opCheatAll(state, gold) {
    const msgs = [];
    if (gold > 0) msgs.push(opGold(state, gold));
    msgs.push(opMaxLevel(state));
    msgs.push(opBoost(state, 9999));
    msgs.push(opAllItems(state, 99));
    msgs.push(opLearnAll(state));
    msgs.push(opMastery(state));
    msgs.push(opUnlockAll(state));
    msgs.push(opPets(state, 'add'));
    msgs.push(opAwaken(state));
    msgs.push(opTaskList(state));
    msgs.push(opSectTask(state));
    msgs.push(opShopLimit(state));
    msgs.push(opUnlockEquip(state));
    msgs.push(opClearNew(state));
    msgs.push(opGiftCode(state, 'reset'));
    msgs.push(opFullHpMp(state));
    return '【一键全解锁】\n' + msgs.map(m => '· ' + m).join('\n');
}

// ---------------- 扩展功能 2: 礼包码/觉醒/任务/宝石 ----------------
function opGiftCode(state, mode) {
    const o = state.obj;
    const ch = state.gameData.cheats;
    if (mode === 'reset') {
        const n = Object.keys(o.system._bzGiftCodeClaimed || {}).length;
        o.system._bzGiftCodeClaimed = {};
        return `已重置礼包码领取记录 (${n} 条)，现在可在游戏菜单「礼包码」里重新兑换全部礼包码`;
    }
    const claimed = o.system._bzGiftCodeClaimed || {};
    const lines = ch.giftCodes.map(g => `  ${claimed[g.code] ? '[已领]' : '[可领]'} ${g.code}  →  ${g.name}`);
    return noChange(`礼包码 (共 ${ch.giftCodes.length} 个，游戏菜单「礼包码」处输入):\n${lines.join('\n')}\n提示: giftcode reset 可重置领取记录`);
}

function opAwaken(state) {
    const ch = state.gameData.cheats;
    const list = partyActors(state);
    list.forEach(({ actor }) => { actor._awakenGauge = ch.awakenMax; });
    return `觉醒值已拉满 → ${ch.awakenMax} (${list.map(x => x.actor._name).join(', ')})`;
}

function opTaskList(state) {
    const o = state.obj;
    const ch = state.gameData.cheats;
    const S = o.system;
    S._bzTaskListData = S._bzTaskListData || {};
    const msgs = [];
    ch.taskLists.forEach(l => {
        S._bzTaskListData[l.listId] = { activeTasks: [], completedTasks: l.taskIds.slice(), killProgress: {} };
        msgs.push(`${l.listName}: ${l.taskIds.length} 个任务标记完成`);
        if (l.scoreVarId > 0) {
            o.variables._data[l.scoreVarId] = 999999;
            const vn = (state.gameData.system.variables || [])[l.scoreVarId] || '';
            msgs.push(`变量[${l.scoreVarId}] ${vn} 已设为 999999`);
        }
    });
    // 冒险者协会等级一并拉满
    const lvIdx = 67;
    if ((state.gameData.system.variables || [])[lvIdx]) {
        o.variables._data[lvIdx] = 99;
        msgs.push(`变量[${lvIdx}] ${state.gameData.system.variables[lvIdx]} 已设为 99`);
    }
    return '冒险者任务:\n  ' + msgs.join('\n  ');
}

function opSectTask(state) {
    const o = state.obj;
    const ch = state.gameData.cheats;
    const S = o.system;
    S._bzSectTaskData = S._bzSectTaskData || {};
    const msgs = [];
    ch.sectGroups.forEach(g => {
        S._bzSectTaskData[g.groupId] = { activeTaskId: '', completedTaskIds: g.taskIds.slice() };
        msgs.push(`${g.groupId}: ${g.taskIds.length} 个`);
    });
    return '门派日常任务已标记完成:\n  ' + msgs.join('\n  ');
}

function opGems(state) {
    const o = state.obj;
    const ch = state.gameData.cheats;
    o.party._items = o.party._items || {};
    let n = 0;
    ch.gems.forEach(g => {
        if ((o.party._items[String(g.id)] || 0) < 99) { o.party._items[String(g.id)] = 99; n++; }
    });
    const lines = ch.gems.map(g => `  #${g.id} ${g.name}${g.effect ? '  (' + g.effect + ')' : ''}`);
    return `宝石共 ${ch.gems.length} 种 (已补给背包，新增${n}种):\n${lines.join('\n')}\n提示: 只有带孔装备(<孔数:N>)才能在游戏内镶嵌`;
}

// ---------------- 备份/恢复 ----------------
function backupDir(state) {
    return path.join(path.dirname(state.savePath), '..', 'trainer_backups');
}

function opBackup(state) {
    const dir = backupDir(state);
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dst = path.join(dir, `${path.basename(state.savePath)}.${ts}.bak`);
    fs.copyFileSync(state.savePath, dst);
    return `已备份到: ${dst}`;
}

function opRestore(state) {
    const dir = backupDir(state);
    if (!fs.existsSync(dir)) return '没有备份目录';
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.bak')).sort().reverse();
    if (files.length === 0) return '没有可用备份';
    // 恢复最新一个
    const src = path.join(dir, files[0]);
    fs.copyFileSync(src, state.savePath);
    return `已恢复最新备份: ${files[0]}`;
}

// ---------------- 执行/提交 ----------------
let _backedUpThisRun = false;
function commit(state) {
    if (!_backedUpThisRun) {
        opBackup(state);          // 首次写入前自动备份
        _backedUpThisRun = true;
    }
    try {
        writeSave(state.savePath, state.obj);
    } catch (e) {
        throw new Error(`写入存档失败（游戏可能正在运行，请先完全退出游戏）: ${e.message}`);
    }
}

// ---------------- 命令分发 ----------------
const HELP_TEXT = [
    '黯渊崛起 存档修改器 — 命令一览',
    '  info                     查看存档信息',
    '  gold <值>                设置金币',
    '  addgold <值>             增加金币',
    '  maxlevel                 队伍全员满级',
    '  level <ID/名字> <等级>     指定角色等级',
    '  fullhp                   队伍满血满蓝',
    '  boost [N]                队伍全员 +N 全属性(默认9999)',
    '  allitems [N]             全物品/武器/防具 x N (默认99)',
    '  item/weapon/armor <名字/ID> [N]   添加指定物品/武器/防具',
    '  sect <值>                门派贡献',
    '  var <序号> <值>            修改变量(任务进度)',
    '  switch <序号> <true|false>  修改开关',
    '  ── 扩展功能 ──',
    '  unlockall                图鉴全解锁(怪物/技能/状态/装备/宠物)',
    '  mastery                  武器&技能精通拉满',
    '  learnall                 队伍学会全部职业技能',
    '  pets [add|unlock]        加入全部宠物 / 仅解锁宠物图鉴',
    '  quests                   已接任务标记完成',
    '  shoplimit                清除商店限购',
    '  unlockequip              清除装备锁定',
    '  clearnew                 清除"新物品"红点',
    '  cheatall [金币]           一键全解锁(可选设置金币)',
    '  giftcode [list|reset]    查看/重置礼包码',
    '  awaken                   觉醒值拉满(队伍)',
    '  tasklist                 冒险者任务全完成 + 积分/等级拉满',
    '  secttask                 门派日常任务标记完成',
    '  gems                     宝石清单 + 补给背包',
    '  ── 其他 ──',
    '  saves                    列出所有存档',
    '  vars / switches          列出全部变量 / 开关',
    '  backup / restore         备份 / 恢复最新备份',
    '\n可选参数: --game <游戏目录>  --save <存档名, 如 file1>',
].join('\n');

const COMMANDS = {
    help:    { run: () => HELP_TEXT },
    info:    { run: s => opInfo(s) },
    gold:    { run: (s, a) => opGold(s, parseInt(a[0], 10)), need: 1 },
    addgold: { run: (s, a) => opAddGold(s, parseInt(a[0], 10)), need: 1 },
    maxlevel:{ run: s => opMaxLevel(s) },
    level:   { run: (s, a) => opLevel(s, a[0], parseInt(a[1], 10)), need: 2 },
    fullhp:  { run: s => opFullHpMp(s) },
    boost:   { run: (s, a) => opBoost(s, a[0] ? parseInt(a[0], 10) : BOOST_DEFAULT) },
    allitems:{ run: (s, a) => opAllItems(s, a[0] ? parseInt(a[0], 10) : ALLITEM_DEFAULT) },
    item:    { run: (s, a) => opAddItem(s, 'item', a[0], a[1] ? parseInt(a[1], 10) : ALLITEM_DEFAULT), need: 1 },
    weapon:  { run: (s, a) => opAddItem(s, 'weapon', a[0], a[1] ? parseInt(a[1], 10) : ALLITEM_DEFAULT), need: 1 },
    armor:   { run: (s, a) => opAddItem(s, 'armor', a[0], a[1] ? parseInt(a[1], 10) : ALLITEM_DEFAULT), need: 1 },
    sect:    { run: (s, a) => opSect(s, parseInt(a[0], 10)), need: 1 },
    var:     { run: (s, a) => opVar(s, parseInt(a[0], 10), parseVarValue(a[1])), need: 2 },
    switch:  { run: (s, a) => opSwitch(s, parseInt(a[0], 10), a[1] === 'true' || a[1] === '1'), need: 2 },
    unlockall:{ run: s => opUnlockAll(s) },
    mastery: { run: s => opMastery(s) },
    learnall:{ run: s => opLearnAll(s) },
    pets:    { run: (s, a) => opPets(s, a[0] === 'unlock' ? 'unlock' : 'add') },
    quests:  { run: s => opQuests(s) },
    shoplimit:{ run: s => opShopLimit(s) },
    unlockequip:{ run: s => opUnlockEquip(s) },
    clearnew:{ run: s => opClearNew(s) },
    cheatall:{ run: (s, a) => opCheatAll(s, a[0] ? parseInt(a[0], 10) : 0) },
    giftcode:{ run: (s, a) => opGiftCode(s, a[0] === 'reset' ? 'reset' : 'list') },
    awaken:  { run: s => opAwaken(s) },
    tasklist:{ run: s => opTaskList(s) },
    secttask:{ run: s => opSectTask(s) },
    gems:    { run: s => opGems(s) },
    backup:  { run: s => noChange(opBackup(s)) },
    restore: { run: s => noChange(opRestore(s)) },
    saves:   { run: s => opListSaves(s) },
    vars:    { run: s => opListVars(s) },
    switches:{ run: s => opListSwitches(s) },
};

function opListVars(state) {
    const names = state.gameData.system.variables || [];
    const data = (state.obj.variables && state.obj.variables._data) || [];
    const lines = [];
    for (let i = 1; i < names.length; i++) {
        const n = names[i];
        if (!n || n === '-----') continue;
        lines.push(`  [${i}] ${n} = ${JSON.stringify(data[i] ?? 0)}`);
    }
    return lines.join('\n') || '(无)';
}

function opListSwitches(state) {
    const names = state.gameData.system.switches || [];
    const data = (state.obj.switches && state.obj.switches._data) || [];
    const lines = [];
    for (let i = 1; i < names.length; i++) {
        const n = names[i];
        if (!n) continue;
        lines.push(`  [${i}] ${n} = ${!!data[i]}`);
    }
    return lines.join('\n') || '(无)';
}

// ---------------- 其他命令 ----------------
function opListSaves(state) {
    const dir = path.dirname(state.savePath);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.rmmzsave'));
    const cur = path.basename(state.savePath);
    return ['存档目录: ' + dir].concat(
        files.map(f => {
            let extra = '';
            try {
                const o = loadSave(path.join(dir, f));
                const t = fmtTime(((o.system && o.system._framesOnSave) || 0) / 60);
                extra = `  金币 ${fmt(o.party._gold)}  时长 ${t}`;
            } catch (e) { extra = '  (无法读取)'; }
            return `  ${f === cur ? '★' : ' '} ${f}${extra}`;
        })
    ).join('\n');
}

function parseVarValue(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (!isNaN(Number(v))) return Number(v);
    return v;
}

function loadState(opts) {
    const gameDir = opts.gameDir;
    if (!fs.existsSync(path.join(gameDir, 'data', 'System.json'))) {
        throw new Error(`未找到游戏目录: ${gameDir} (请用 --game 指定正确路径)`);
    }
    const savePath = path.join(gameDir, 'save', opts.saveName.endsWith('.rmmzsave') ? opts.saveName : opts.saveName + '.rmmzsave');
    if (!fs.existsSync(savePath)) {
        throw new Error(`未找到存档: ${savePath}`);
    }
    const gameData = {
        itemsMap: buildIdMap(loadData(gameDir, 'Items')),
        weaponsMap: buildIdMap(loadData(gameDir, 'Weapons')),
        armorsMap: buildIdMap(loadData(gameDir, 'Armors')),
        actorsMap: buildIdMap(loadData(gameDir, 'Actors')),
        classesMap: buildIdMap(loadData(gameDir, 'Classes')),
        skillsMap: buildIdMap(loadData(gameDir, 'Skills')),
        statesMap: buildIdMap(loadData(gameDir, 'States')),
        system: loadData(gameDir, 'System'),
    };
    gameData.cheats = buildCheatData(gameDir, gameData);
    return { gameDir, savePath, gameData, obj: loadSave(savePath) };
}

function runCommand(opts, state) {
    const cmd = COMMANDS[opts.cmd];
    if (!cmd) {
        console.error(`未知命令「${opts.cmd}」。可用命令:\n  ${Object.keys(COMMANDS).join(', ')}`);
        process.exit(1);
    }
    if (cmd.need && opts.args.length < cmd.need) {
        console.error(`命令 ${opts.cmd} 需要 ${cmd.need} 个参数`);
        process.exit(1);
    }
    const m = cmd.run(state, opts.args);
    console.log(textOf(m));
        const readOnly = ['info', 'backup', 'restore', 'saves', 'help', 'vars', 'switches'].includes(opts.cmd);
    if (!readOnly && changedOf(m)) {
        commit(state);
        console.log('已写回存档 ✓');
    }
}

// ---------------- 交互菜单 ----------------
function header(state) {
    const o = state.obj;
    const party = o.party._actors || [];
    const names = party.map(id => {
        const a = o.actors._data[id];
        return a ? `${a._name}(Lv${a._level})` : `#${id}`;
    }).join(', ');
    return [
        `金币 ${fmt(o.party._gold)} | 队伍: ${names || '(空)'}`,
        `存档: ${state.savePath}`,
    ].join('\n');
}

function interactiveMenu(state) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    const menu = [
        ['1', '查看详细信息', s => { console.log(opInfo(s)); return false; }],
        ['2', '设置金币', s => promptNumber(ask, '金币数量: ').then(v => apply(s, () => opGold(s, v)))],
        ['3', '增加金币', s => promptNumber(ask, '增加数量: ').then(v => apply(s, () => opAddGold(s, v)))],
        ['4', '队伍全员满级', s => Promise.resolve(apply(s, () => opMaxLevel(s)))],
        ['5', '指定角色等级', s => promptStr(ask, '角色 ID/名字: ').then(q => promptNumber(ask, '等级: ').then(l => apply(s, () => opLevel(s, q, l))))],
        ['6', '满血满蓝(队伍)', s => Promise.resolve(apply(s, () => opFullHpMp(s)))],
        ['7', '属性拉满 +9999', s => Promise.resolve(apply(s, () => opBoost(s, BOOST_DEFAULT)))],
        ['8', '全物品 x99', s => Promise.resolve(apply(s, () => opAllItems(s, ALLITEM_DEFAULT)))],
        ['9', '添加物品', s => promptStr(ask, '类型(item/weapon/armor): ').then(k => promptStr(ask, '名字或ID: ').then(q => promptNumber(ask, '数量(默认99): ', ALLITEM_DEFAULT).then(n => apply(s, () => opAddItem(s, k, q, n)))))],
        ['10', '门派贡献', s => promptNumber(ask, '门派贡献: ').then(v => apply(s, () => opSect(s, v)))],
        ['11', '修改变量(任务)', s => promptNumber(ask, '变量序号: ').then(i => promptStr(ask, '值: ').then(v => apply(s, () => opVar(s, i, parseVarValue(v)))))],
        ['12', '图鉴全解锁', s => Promise.resolve(apply(s, () => opUnlockAll(s)))],
        ['13', '精通拉满(武器/技能)', s => Promise.resolve(apply(s, () => opMastery(s)))],
        ['14', '学会全部技能', s => Promise.resolve(apply(s, () => opLearnAll(s)))],
        ['15', '加入全部宠物', s => Promise.resolve(apply(s, () => opPets(s, 'add')))],
        ['16', '已接任务标记完成', s => Promise.resolve(apply(s, () => opQuests(s)))],
        ['17', '清除商店限购/装备锁/红点', s => Promise.resolve(apply(s, () => opShopLimit(s) + '\n' + opUnlockEquip(s) + '\n' + opClearNew(s)))],
        ['18', '★ 一键全解锁(含金币)', s => promptNumber(ask, '金币(留空不改): ', 0).then(g => apply(s, () => opCheatAll(s, g || 99999999)))],
        ['19', '礼包码(查看/重置)', s => promptStr(ask, 'list 或 reset: ').then(m => apply(s, () => opGiftCode(s, m.trim() === 'reset' ? 'reset' : 'list')))],
        ['20', '觉醒值拉满', s => Promise.resolve(apply(s, () => opAwaken(s)))],
        ['21', '冒险者任务全完成', s => Promise.resolve(apply(s, () => opTaskList(s)))],
        ['22', '门派日常任务', s => Promise.resolve(apply(s, () => opSectTask(s)))],
        ['23', '宝石清单+补给', s => Promise.resolve(apply(s, () => opGems(s)))],
        ['b', '备份存档', s => { console.log(opBackup(s)); return false; }],
        ['r', '恢复最新备份', s => { console.log(opRestore(s)); s.obj = loadSave(s.savePath); console.log('已重新载入存档 ✓'); return false; }],
        ['l', '列出所有存档', s => { console.log(opListSaves(s)); return false; }],
        ['v', '列出变量/开关', s => { console.log(opListVars(s)); console.log('\n--- 开关 ---'); console.log(opListSwitches(s)); return false; }],
        ['q', '退出', () => { rl.close(); process.exit(0); }],
    ];

    function apply(s, fn) {
        const m = fn();
        console.log(textOf(m));
        if (changedOf(m)) {
            commit(s);
            console.log('已写回存档 ✓');
        }
        return false;
    }

    function promptNumber(askFn, q, def) {
        return askFn(q).then(a => { const n = parseInt(a, 10); return isNaN(n) ? def : n; });
    }
    function promptStr(askFn, q) { return askFn(q); }

    async function loop() {
        console.log('\n========== 黯渊崛起 存档修改器 ==========');
        console.log(header(state));
        console.log('----------------------------------------');
        menu.forEach(m => console.log(`  [${m[0]}] ${m[1]}`));
        console.log('----------------------------------------');
        const ans = (await ask('选择: ')).trim();
        const item = menu.find(m => m[0] === ans);
        if (item) {
            await item[2](state);
        } else {
            console.log('无效选择');
        }
        return loop();
    }
    return loop();
}

// ---------------- 入口 ----------------
function main() {
    const opts = parseArgs(process.argv.slice(2));
    let state;
    try {
        state = loadState(opts);
    } catch (e) {
        console.error('错误: ' + e.message);
        process.exit(1);
    }
    if (opts.cmd) {
        try {
            runCommand(opts, state);
        } catch (e) {
            console.error('错误: ' + e.message);
            process.exit(1);
        }
    } else {
        interactiveMenu(state).catch(e => { console.error('错误: ' + e.message); process.exit(1); });
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    loadSave,
    encodeSave,
    writeSave,
    loadState,
    buildCheatData,
    COMMANDS,
};
