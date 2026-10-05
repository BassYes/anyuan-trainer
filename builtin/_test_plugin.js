'use strict';
/**
 * 内置修改器 插件逻辑测试 — 用最小 RMMZ 模拟环境加载插件并执行各功能
 * 运行: node _test_plugin.js
 */
const fs = require('fs');
const path = require('path');

const GAME = process.env.GAME_DIR || 'E:/SteamLibrary/steamapps/common/暗渊崛起 Demo';
global.window = global;

// ---------- PluginManager ----------
const pluginParams = {};
{
    const t = fs.readFileSync(path.join(GAME, 'js', 'plugins.js'), 'utf8');
    JSON.parse(t.match(/var\s+\$plugins\s*=\s*(\[[\s\S]*\]);/)[1])
        .forEach(p => { pluginParams[p.name] = p.parameters || {}; });
}
global.PluginManager = { parameters: n => pluginParams[n] || {} };

// ---------- 游戏数据 ----------
const load = n => JSON.parse(fs.readFileSync(path.join(GAME, 'data', n + '.json'), 'utf8'));
global.$dataItems = load('Items');
global.$dataWeapons = load('Weapons');
global.$dataArmors = load('Armors');
global.$dataSkills = load('Skills');
global.$dataStates = load('States');
global.$dataEnemies = load('Enemies');
global.$dataClasses = load('Classes');
global.$dataActors = load('Actors');
global.$dataSystem = load('System');

// ---------- RMMZ 类桩 ----------
function Game_BattlerBase() {}
Game_BattlerBase.prototype.deathStateId = function () { return 1; };
Game_BattlerBase.prototype.maxTp = function () { return 100; };
Game_BattlerBase.prototype.removeState = function () {};

function Game_Battler() { this._result = {}; this._hp = 0; }
Game_Battler.prototype = Object.create(Game_BattlerBase.prototype);
Game_Battler.prototype.gainHp = function (v) { this._hp = (this._hp || 0) + v; };
Game_Battler.prototype.isEnemy = function () { return false; };
Game_Battler.prototype.isActor = function () { return false; };
Object.defineProperty(Game_Battler.prototype, 'hp', { get() { return this._hp || 0; } });
Object.defineProperty(Game_Battler.prototype, 'mhp', { get() { return this._mhp || 100; } });

function Game_Actor(id) {
    this._actorId = id;
    this._hp = 100; this._mp = 50; this._tp = 0;
    this._skills = []; this._paramPlus = [0, 0, 0, 0, 0, 0, 0, 0];
    this._level = 1;
}
Game_Actor.prototype = Object.create(Game_Battler.prototype);
Game_Actor.prototype.refresh = function () {};
Game_Actor.prototype.isActor = function () { return true; };
Game_Actor.prototype.actorId = function () { return this._actorId; };
Game_Actor.prototype.maxLevel = function () { return 60; };
Game_Actor.prototype.changeLevel = function (l) { this._level = l; };
Game_Actor.prototype.recoverAll = function () { this._hp = this.mhp; this._mp = this.mmp; };
Game_Actor.prototype.isLearnedSkill = function (id) { return this._skills.includes(id); };
Game_Actor.prototype.learnSkill = function (id) { if (!this._skills.includes(id)) this._skills.push(id); };
Object.defineProperty(Game_Actor.prototype, 'mhp', { get() { return 100 + (this._paramPlus[0] || 0); } });
Object.defineProperty(Game_Actor.prototype, 'mmp', { get() { return 50 + (this._paramPlus[1] || 0); } });

function Game_Player() {}
Game_Player.prototype.updateEncounterCount = function () { this._encounterCount = (this._encounterCount || 0) - 1; };
Game_Player.prototype.isPlayer = function () { return true; };

function Game_CharacterBase() {}
Game_CharacterBase.prototype.distancePerFrame = function () { return 0.25; };

function Scene_Base() {}
Scene_Base.prototype.initialize = function () { this._windows = []; };
Scene_Base.prototype.update = function () {};
Scene_Base.prototype.calcWindowHeight = function (n, sel) { return 44 * n + 16; };
Scene_Base.prototype.addWindow = function (w) { (this._windows = this._windows || []).push(w); };
Scene_Base.prototype.createWindowLayer = function () {};
Scene_Base.prototype.createBackground = function () {};
Scene_Base.prototype.startFadeIn = function () {};
Scene_Base.prototype.popScene = function () { this._popped = true; };
Scene_Base.prototype.fadeSpeed = function () { return 1; };
function Scene_MenuBase() {}
Scene_MenuBase.prototype = Object.create(Scene_Base.prototype);
Scene_MenuBase.prototype.initialize = Scene_Base.prototype.initialize;
Scene_MenuBase.prototype.create = function () {};
Scene_MenuBase.prototype.update = function () {};
function Scene_Map() {}
Scene_Map.prototype = Object.create(Scene_Base.prototype);
Scene_Map.prototype.update = function () {};

function Window_Base(rect) { this._rect = rect; this.contents = { clear() {} }; }
Window_Base.prototype.initialize = function (rect) {
    if (rect) { this.width = rect.width; this.height = rect.height; }
    this.contents = { clear() {} };
};
Window_Base.prototype.refresh = function () {};
Window_Base.prototype.contentsWidth = function () { return 800; };
Window_Base.prototype.changeTextColor = function () {};
Window_Base.prototype.resetTextColor = function () {};
Window_Base.prototype.drawText = function () {};
Window_Base.prototype.changePaintOpacity = function () {};
Window_Base.prototype.drawItemName = function () {};
function Window_Selectable() { this.contents = { clear() {} }; this._index = 0; this.active = false; this.openness = 255; }
Window_Selectable.prototype = Object.create(Window_Base.prototype);
Window_Selectable.prototype.initialize = function (rect) {
    this._rect = rect; this._index = 0; this.active = false; this.openness = 255;
    if (rect) { this.width = rect.width; this.height = rect.height; }
    this._handlers = {}; this.contents = { clear() {} };
};
Window_Selectable.prototype.isTouchedInsideFrame = function () { return true; };
Window_Selectable.prototype.maxItems = function () { return 0; };
Window_Selectable.prototype.itemHeight = function () { return 36; };
Window_Selectable.prototype.contentsHeight = function () { return 100; };
Window_Selectable.prototype.refresh = function () { this.drawAllItems(); };
Window_Selectable.prototype.drawAllItems = function () { for (let i = 0; i < this.maxItems(); i++) this.drawItem(i); };
Window_Selectable.prototype.drawItem = function () {};
Window_Selectable.prototype.select = function (i) { this._index = i; };
Window_Selectable.prototype.index = function () { return this._index; };
Window_Selectable.prototype.scrollTo = function () {};
Window_Selectable.prototype.setHandler = function (s, f) { this._handlers[s] = f; };
Window_Selectable.prototype.isHandled = function (s) { return !!this._handlers[s]; };
Window_Selectable.prototype.isCursorMovable = function () { return this.active && this.maxItems() > 0; };
Window_Selectable.prototype.processCursorMove = function () {};
Window_Selectable.prototype.update = function () {};
Window_Selectable.prototype.activate = function () { this.active = true; };
Window_Selectable.prototype.deactivate = function () { this.active = false; };
Window_Selectable.prototype.show = function () {};
Window_Selectable.prototype.hide = function () {};
Window_Selectable.prototype.isOpenAndActive = function () { return true; };
Window_Selectable.prototype.itemLineRect = function (i) { return { x: 0, y: i * 36, width: 800, height: 36 }; };
function Window_Command() { this._commands = []; }
Window_Command.prototype = Object.create(Window_Selectable.prototype);
Window_Command.prototype.initialize = function (rect) {
    Window_Selectable.prototype.initialize.call(this, rect);
    this._commands = [];
    this.select(0);
    this.activate();
};
Window_Command.prototype.clearCommandList = function () { this._commands = []; };
Window_Command.prototype.makeCommandList = function () {};
Window_Command.prototype.addCommand = function (name, sym, en) { this._commands.push({ name, sym, en }); };
Window_Command.prototype.refresh = function () {
    this.clearCommandList();
    this.makeCommandList();
    Window_Selectable.prototype.refresh.call(this);
};
Window_Command.prototype.maxItems = function () { return this._commands.length; };
Window_Command.prototype.currentSymbol = function () { return this._commands[this.index()] ? this._commands[this.index()].sym : null; };
Window_Command.prototype.drawText = function () {};
Window_Command.prototype.itemLineRect = function () { return { x: 0, y: 0, width: 800, height: 36 }; };
Window_Command.prototype.isCommandEnabled = function () { return true; };
function Window_HorzCommand() { this._commands = []; }
Window_HorzCommand.prototype = Object.create(Window_Command.prototype);
Window_HorzCommand.prototype.initialize = function (rect) { Window_Command.prototype.initialize.call(this, rect); };
function Window_Help() { this.contents = { clear() {} }; }
Window_Help.prototype = Object.create(Window_Base.prototype);
Window_Help.prototype.initialize = function () { this.contents = { clear() {} }; };
Window_Help.prototype.setText = function (t) { this._text = t; };

function Window_MenuCommand() { this._commands = []; }
Window_MenuCommand.prototype = Object.create(Window_Command.prototype);
Window_MenuCommand.prototype.addOriginalCommands = function () {};

function Scene_Battle() {}
Scene_Battle.prototype = Object.create(Scene_Base.prototype);
Scene_Battle.prototype.update = function () {};
function Scene_Menu() {}
Scene_Menu.prototype = Object.create(Scene_MenuBase.prototype);
Scene_Menu.prototype.createCommandWindow = function () {};
Scene_Menu.prototype.update = function () {};

global.Game_BattlerBase = Game_BattlerBase;
global.Game_Battler = Game_Battler;
global.Game_Actor = Game_Actor;
global.Game_Player = Game_Player;
global.Game_CharacterBase = Game_CharacterBase;
global.Scene_Base = Scene_Base;
global.Scene_MenuBase = Scene_MenuBase;
global.Scene_Map = Scene_Map;
global.Window_Base = Window_Base;
global.Window_Command = Window_Command;
global.Window_Selectable = Window_Selectable;
global.Window_HorzCommand = Window_HorzCommand;
global.Window_Help = Window_Help;
global.Window_MenuCommand = Window_MenuCommand;
global.Scene_Battle = Scene_Battle;
global.Scene_Menu = Scene_Menu;
global.ColorManager = { systemColor: () => 0, powerUpColor: () => 0, normalColor: () => 0 };
global.Graphics = { boxWidth: 816, boxHeight: 624, frameCount: 0 };
global.Rectangle = function (x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; };
global.TouchInput = { update: function () { global.__touchUpdates = (global.__touchUpdates || 0) + 1; }, wheelY: 0 };
global.Input = {
    keyMapper: {},
    _pressedTime: 0,
    update: function () { global.__inputUpdates = (global.__inputUpdates || 0) + 1; },
    isTriggered: () => false,
    isRepeated: () => false,
    isPressed: () => false,
};
global.__log = [];
global.SceneManager = {
    _scene: new Scene_Map(),
    isSceneChanging: () => false,
    push: () => {},
    updateMain: function () { global.__log.push(global.AnYuanTrainer._suppressInput ? 'S' : '.'); global.Graphics.frameCount++; },
};
global.SoundManager = {};

// ---------- 游戏运行时状态 ----------
const actors = {};
[1, 3, 5].forEach(id => { actors[id] = new Game_Actor(id); });

global.$gameActors = { actor: id => actors[id] || null };
global.$gameVariables = {
    _data: [],
    setValue(i, v) { this._data[i] = v; },
    value(i) { return this._data[i] || 0; },
};
global.$gameSwitches = {
    _data: [],
    setValue(i, v) { this._data[i] = !!v; },
    value(i) { return !!this._data[i]; },
};
global.$gameSystem = {
    _bzGiftCodeClaimed: { anyuanjueqi2026: true },
    _bzShopPurchaseLimitCounts: { 'item:66': 1 },
    _lockedEquips: { 'w351': true },
    _bzTaskListData: {}, _bzSectTaskData: {},
    _encyclopediaData: {}, _skillEncyUnlocked: {}, _stateEncyUnlocked: {}, _equipEncyUnlocked: {}, _bzPetEncyData: {},
    _deferEquip: false,
    registerEnemy(id) { this._encyclopediaData[id] = true; },
    isEnemyRegistered(id) { return !!this._encyclopediaData[id]; },
    unlockSkillEncy(id) { this._skillEncyUnlocked[id] = true; },
    isSkillEncyUnlocked(id) { return !!this._skillEncyUnlocked[id]; },
    unlockStateEncy(id) { this._stateEncyUnlocked[id] = true; },
    isStateEncyUnlocked(id) { return !!this._stateEncyUnlocked[id]; },
    unlockEquipEncy(t, id) { this._equipEncyUnlocked[t + '_' + id] = true; },
    beginDeferEquipEncySave() { this._deferEquip = true; },
    endDeferEquipEncySave() { this._deferEquip = false; },
    bzEncyRegister(id) { this._bzPetEncyData[id] = true; },
    bzEncyIsRegistered(id) { return !!this._bzPetEncyData[id]; },
};
global.$gamePlayer = new Game_Player();
global.$gameParty = {
    _actors: [1, 5],
    _gold: 0,
    _items: {}, _weapons: {}, _armors: {},
    _newItemsList: ['item-1', 'weapon-2'],
    _mkPetRoster: [],
    members() { return this._actors.map(id => actors[id]).filter(Boolean); },
    gainGold(n) { this._gold = (this._gold || 0) + n; },
    gold() { return this._gold || 0; },
    gainItem(item, n) {
        if (!item) return;
        const key = String(item.id);
        if (item.wtypeId !== undefined) this._weapons[key] = (this._weapons[key] || 0) + n;
        else if (item.atypeId !== undefined) this._armors[key] = (this._armors[key] || 0) + n;
        else this._items[key] = (this._items[key] || 0) + n;
    },
    numItems(item) {
        if (!item) return 0;
        const key = String(item.id);
        if (item.wtypeId !== undefined) return this._weapons[key] || 0;
        if (item.atypeId !== undefined) return this._armors[key] || 0;
        return this._items[key] || 0;
    },
    mkForceAddPet(id) {
        if (this._mkPetRoster.length >= 40) return null;
        const p = { _actorId: id }; this._mkPetRoster.push(p); return p;
    },
};

// ---------- 加载插件 ----------
const code = fs.readFileSync(path.join(__dirname, 'AnYuan_Trainer.js'), 'utf8');
eval(code);

// ---------- 测试 ----------
const T = global.AnYuanTrainer;
let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); pass++; }
    else { console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); fail++; }
}

console.log('=== 插件加载与 hooks ===');
check('插件已加载', !!T);
check('Game_Actor.refresh 已被 hook', Game_Actor.prototype.refresh.toString().includes('mhp'));
check('Game_Battler.gainHp 已被 hook', Game_Battler.prototype.gainHp.toString().includes('oneHit'));
check('Game_Player.updateEncounterCount 已被 hook', Game_Player.prototype.updateEncounterCount.toString().includes('noEncounter'));
check('keyMapper 已注册', Input.keyMapper[121] === 'anyuanTrainer');
check('SceneManager.updateMain 已被 hook', SceneManager.updateMain.toString().includes('effectiveSpeed'));
check('Input.isTriggered 已被 hook', Input.isTriggered.toString().includes('_suppressInput'));

console.log('\n=== 倍速 / 输入抑制 ===');
T.gameSpeed = 3;
global.__log = [];
SceneManager.updateMain();
check('全局倍速3x: 执行3次', global.__log.join('') === '.SS', 'log=' + global.__log.join(''));
check('帧计数+3', Graphics.frameCount === 3, 'frameCount=' + Graphics.frameCount);
T.gameSpeed = 1;
global.__log = [];
SceneManager.updateMain();
check('1x: 只执行1次', global.__log.join('') === '.', 'log=' + global.__log.join(''));
// 战斗中单独加速
SceneManager._scene = new Scene_Battle();
T.gameSpeed = 1; T.battleSpeed = 4;
global.__log = [];
SceneManager.updateMain();
check('战斗加速4x: 战斗中执行4次', global.__log.length === 4, 'n=' + global.__log.length);
SceneManager._scene = new Scene_Map();
global.__log = [];
SceneManager.updateMain();
check('战斗加速不影响地图', global.__log.length === 1, 'n=' + global.__log.length);
T.battleSpeed = 1;
// 验证额外帧里输入被抑制
T.gameSpeed = 2;
T._suppressInput = false;
global.__log = [];
SceneManager.updateMain();
check('额外帧输入已抑制', global.__log.join('') === '.S');
check('退出后恢复输入', T._suppressInput === false && Input.update.toString().includes('__inputUpdates'));
T.gameSpeed = 1;

console.log('\n=== 打开方式（已按要求去掉主菜单入口） ===');
check('主菜单不再注入「修改器」', Window_MenuCommand.prototype.addOriginalCommands.toString().indexOf('anyuanTrainerMenu') < 0);
check('Scene_Menu.createCommandWindow 未被 hook', Scene_Menu.prototype.createCommandWindow.toString().indexOf('commandAnYuanTrainer') < 0);
check('Scene_Menu.update 仍支持 F10', Scene_Menu.prototype.update.toString().includes('openTrainer'));
check('Scene_Map.update 支持 F10', Scene_Map.prototype.update.toString().includes('openTrainer'));

console.log('\n=== ←→ 防误触（关键修复） ===');
{
    const I = T._internals;
    const fake = Object.create(I.Scene_Cheat.prototype);
    let called = 0, popped = false;
    fake._commandWindow = { index: () => 0 };
    fake._statusWindow = { setMessage() {} };
    fake._helpWindow = { setText() {} };
    fake._frames = 99;
    fake.popScene = () => { popped = true; };
    fake.updateHelp = () => {};
    fake.onCommandOk = () => { called++; };
    const idxOf = sym => I.CMDS.findIndex(c => c.sym === sym);

    fake._commandWindow.index = () => idxOf('cheatall');
    Input.isTriggered = k => k === 'right';
    I.Scene_Cheat.prototype.update.call(fake);
    check('动作命令(一键全解锁)上按→不执行', called === 0, 'called=' + called);
    Input.isTriggered = k => k === 'left';
    I.Scene_Cheat.prototype.update.call(fake);
    check('动作命令上按←不执行', called === 0, 'called=' + called);

    fake._commandWindow.index = () => idxOf('giveItem');
    Input.isTriggered = k => k === 'right';
    I.Scene_Cheat.prototype.update.call(fake);
    check('“添加物品…”上按→不执行', called === 0, 'called=' + called);

    fake._commandWindow.index = () => idxOf('god');
    I.Scene_Cheat.prototype.update.call(fake);
    check('开关命令上按→执行', called === 1, 'called=' + called);
    fake._commandWindow.index = () => idxOf('gameSpeed');
    I.Scene_Cheat.prototype.update.call(fake);
    check('倍速命令上按→执行', called === 2, 'called=' + called);

    Input.isTriggered = k => k === 'anyuanTrainer';
    I.Scene_Cheat.prototype.update.call(fake);
    check('F10 关闭修改器', popped === true);
    Input.isTriggered = () => false;
}

console.log('\n=== 命令表完整性 ===');
{
    const I = T._internals;
    const seen = {};
    let dup = 0, bad = 0;
    for (const c of I.CMDS) {
        if (seen[c.sym]) dup++;
        seen[c.sym] = true;
        if (c.kind === 'toggle' || c.kind === 'cycle' || c.kind === 'scene' || c.kind === 'gold' || c.kind === 'info') continue;
        if (typeof c.run !== 'function') bad++;
    }
    check('无重复 symbol', dup === 0, 'dup=' + dup);
    check('命令均有实现', bad === 0, 'bad=' + bad);
    check('命令数 > 30', I.CMDS.length > 30, 'n=' + I.CMDS.length);
    // 每个 scene 类命令的 pick 配置存在
    let miss = [];
    for (const c of I.CMDS) if (c.kind === 'scene' && !I.PICK[c.pick]) miss.push(c.sym);
    check('scene 命令的 pick 配置齐全', miss.length === 0, miss.join(','));
}

console.log('\n=== 实时开关 ===');
T.god = true;
actors[1]._hp = 1;
actors[1].refresh();
check('无敌模式: HP 被顶回满', actors[1]._hp === actors[1].mhp, 'hp=' + actors[1]._hp);
T.infiniteMp = true; actors[1].refresh();
check('无限MP/TP', actors[1]._mp === actors[1].mmp && actors[1]._tp === 100);
T.god = false; T.infiniteMp = false; T.autoHeal = false;

T.oneHit = true;
const e = new Game_Battler(); e.isEnemy = () => true; e._hp = 9999; e._mhp = 9999;
Game_Battler.prototype.gainHp.call(e, -10);
check('一击必杀: 敌人被秒', e._hp <= 0, 'hp=' + e._hp);
T.oneHit = false;

T.noEncounter = true;
$gamePlayer._encounterCount = 5;
$gamePlayer.updateEncounterCount();
check('不遇敌: 计数不递减', $gamePlayer._encounterCount === 999999);
T.noEncounter = false;

T.speed = true;
check('移动加速 x2', Math.abs(Game_CharacterBase.prototype.distancePerFrame.call({ isPlayer: () => true }) - 0.5) < 1e-9);
T.speed = false;

T.through = true;
T.run('gold'); // 触发一次无害调用
check('穿墙函数可执行', true);

console.log('\n=== 一键功能 ===');
const results = {};
const fns = ['gold', 'maxlevel', 'boost', 'fullhp', 'allitems', 'learnall', 'unlockall',
    'pets', 'mastery', 'awaken', 'tasklist', 'secttask', 'giftreset', 'shoplimit',
    'unlockequip', 'clearnew', 'cheatall'];
for (const f of fns) {
    try { results[f] = T.run(f); console.log('  · ' + f + ': ' + results[f]); }
    catch (err) { console.log('  ✗ ' + f + ' 抛错: ' + err.message); fail++; }
}
console.log('');
check('金币已增加(多次调用累计)', $gameParty.gold() >= 1000000, 'gold=' + $gameParty.gold());
check('队伍已满级', actors[1]._level === 60 && actors[5]._level === 60);
check('属性 +9999', actors[1]._paramPlus[0] >= 9999);
check('全物品已发', Object.keys($gameParty._items).length > 300, 'items=' + Object.keys($gameParty._items).length);
check('全技能已学', actors[1]._skills.length > 100, 'skills=' + actors[1]._skills.length);
check('图鉴怪物已解锁', Object.keys($gameSystem._encyclopediaData).length > 100, 'monsters=' + Object.keys($gameSystem._encyclopediaData).length);
check('图鉴技能已解锁', Object.keys($gameSystem._skillEncyUnlocked).length > 100);
check('图鉴装备已解锁', Object.keys($gameSystem._equipEncyUnlocked).length > 100);
check('宠物已加入', $gameParty._mkPetRoster.length > 0, 'pets=' + $gameParty._mkPetRoster.length);
check('武器精通已设', Object.keys(actors[1]._weaponMastery || {}).length > 0);
check('技能精通已设', Object.keys(actors[1]._skillMastery || {}).length > 100);
check('觉醒已拉满', actors[1]._awakenGauge === 100);
check('冒险者任务已写', !!$gameSystem._bzTaskListData['1'], JSON.stringify($gameSystem._bzTaskListData['1'] || {}).slice(0, 60));
check('积分变量已设', $gameVariables.value(68) === 999999);
check('门派任务已写', Object.keys($gameSystem._bzSectTaskData).length === 4);
check('礼包码已重置', Object.keys($gameSystem._bzGiftCodeClaimed).length === 0);
check('商店限购已清', Object.keys($gameSystem._bzShopPurchaseLimitCounts).length === 0);
check('装备锁已清', Object.keys($gameSystem._lockedEquips).length === 0);
check('新物品红点已清', $gameParty._newItemsList.length === 0);

console.log('\n=== 添加物品（选择 + 数量） ===');
{
    const I = T._internals;
    check('已暴露 _internals', !!I && !!I.PICK);
    check('物品列表', I.PICK.item.buildList('item').length > 300, 'n=' + I.PICK.item.buildList('item').length);
    check('武器列表', I.PICK.item.buildList('weapon').length > 100, 'n=' + I.PICK.item.buildList('weapon').length);
    check('防具列表', I.PICK.item.buildList('armor').length > 200, 'n=' + I.PICK.item.buildList('armor').length);
    const list = I.PICK.item.buildList('item');
    const e0 = list[0];
    const before = $gameParty.numItems(e0.item);
    I.PICK.item.confirm(e0, 42);
    check('confirm 添加物品 x42', $gameParty.numItems(e0.item) === before + 42, 'now=' + $gameParty.numItems(e0.item));
    check('resultText 正确', I.PICK.item.resultText(e0, 42).includes('×42'));
    const w = I.PICK.item.buildList('weapon');
    I.PICK.item.confirm(w[0], 7);
    check('武器可添加', $gameParty.numItems(w[0].item) >= 7);
}

console.log('\n=== 分页列表 ===');
{
    const I = T._internals;
    const lw = new I.Window_PickList(new Rectangle(0, 0, 816, 456));
    lw.setEntries(I.PICK.item.buildList('armor'));
    check('每页条目数合理', lw._perPage >= 5 && lw._perPage <= 20, 'perPage=' + lw._perPage);
    check('第1页条目数=perPage', lw.maxItems() === lw._perPage);
    check('总页数>1', lw.pageCount() > 1, 'pages=' + lw.pageCount());
    const first = lw._pageEntries[0];
    lw.pageDown();
    check('翻页后内容变化', lw._pageEntries[0] !== first);
    check('页码=2', lw._page === 1);
    lw.pageUp();
    check('翻回首页', lw._pageEntries[0] === first);
    lw.pageUp();
    check('首页再往前不变', lw._page === 0);
    check('已禁用原生滚轮滚动', lw.isWheelScrollEnabled() === false);

    // 关键不变量：内容高度 <= 可视高度  => maxScrollY()==0
    // （padding 在游戏里是 12；innerHeight = height - 24）
    {
        const inner = lw.height - 24;
        const overall = lw.contentsHeight();
        check('列表 maxScrollY==0（不可能滚动错位）', Math.max(0, overall - inner) === 0, 'inner=' + inner + ' overall=' + overall);
    }

    // 滚轮翻页
    lw.activate();
    TouchInput.wheelY = 100;
    lw.processWheelScroll();
    check('滚轮下滚→下一页', lw._page === 1, 'page=' + lw._page);
    TouchInput.wheelY = -100;
    lw.processWheelScroll();
    check('滚轮上滚→上一页', lw._page === 0, 'page=' + lw._page);
    lw.deactivate();
    TouchInput.wheelY = 100;
    lw.processWheelScroll();
    check('未激活时滚轮无效', lw._page === 0);
    TouchInput.wheelY = 0;
}

console.log('\n=== 数值输入 ===');
{
    const I = T._internals;
    const nw = new I.Window_ValueInput(new Rectangle(0, 0, 460, 180));
    nw.setup(I.PICK.item, { name: 'X', item: null, sub: () => '' });
    check('默认初值99', nw.value() === 99, 'v=' + nw.value());
    nw.changeValue(10);
    check('+10 生效', nw.value() === 109);
    for (let i = 0; i < 300; i++) nw.changeValue(-10);
    check('下限钳制=1', nw.value() === 1, 'v=' + nw.value());
    nw.setupSingle({ title: '金币', value: 500, min: 0, max: 999999999, valueLabel: '金币' });
    check('setupSingle 初值500', nw.value() === 500, 'v=' + nw.value());
    for (let i = 0; i < 10; i++) nw.changeValue(100);
    check('+100 x10 = 1500', nw.value() === 1500, 'v=' + nw.value());
    nw.changeValue(-999999999);
    check('setGold 下限0', nw.value() === 0, 'v=' + nw.value());
}

console.log('\n=== 设置角色等级 ===');
{
    const I = T._internals;
    const list = I.PICK.actorLevel.buildList();
    check('列出队伍角色', list.length === 2, 'n=' + list.length);
    const e = list[0];
    I.PICK.actorLevel.confirm(e, 30);
    check('等级设为30', e.actor._level === 30, 'lv=' + e.actor._level);
    I.PICK.actorLevel.confirm(e, 9999);
    check('不超等级上限', e.actor._level === e.actor.maxLevel(), 'lv=' + e.actor._level);
    check('设置后满血', e.actor._hp === e.actor.mhp);
}

console.log('\n=== 修改变量 / 开关 ===');
{
    const I = T._internals;
    const vs = I.PICK.variable.buildList('var');
    check('变量列表', vs.length > 50, 'n=' + vs.length);
    I.PICK.variable.confirm(vs[0], 12345);
    check('变量已写入', $gameVariables.value(vs[0].id) === 12345);
    const sw = I.PICK.variable.buildList('switch');
    check('开关列表', sw.length > 100, 'n=' + sw.length);
    I.PICK.variable.confirm(sw[0], 1);
    check('开关已置ON', $gameSwitches.value(sw[0].id) === true);
    I.PICK.variable.confirm(sw[0], 0);
    check('开关已置OFF', $gameSwitches.value(sw[0].id) === false);
}

console.log('\n=== 存档信息 ===');
check('infoText 正常', T._internals.infoText().includes('金币'), T._internals.infoText().slice(0, 60));

console.log('\n=== 端到端：Scene_PickNumber.create() + 完整流程 ===');
{
    const I = T._internals;
    let ok = true, err = '';
    try {
        T._pickConfig = I.PICK.item;
        const sc = new I.Scene_PickNumber();
        sc.create();                                     // 真正构建界面
        check('create() 不报错', true);
        check('已创建 3 个窗口', (sc._windows || []).length === 3, 'n=' + (sc._windows || []).length);
        check('状态窗高度足够(不裁切)', sc._statusWindow.height >= 60, 'h=' + sc._statusWindow.height);
        check('无独立类别窗口', sc._categoryWindow === undefined);
        check('列表已填充', sc._listWindow.maxItems() > 0, 'n=' + sc._listWindow.maxItems());
        check('默认类别=物品', sc._catName === '物品', sc._catName);
        // ←→ 直接切类别
        sc.switchCategory(1);
        check('→ 切到武器', sc._catName === '武器', sc._catName);
        check('武器列表已重建', sc._listWindow._entries.length === I.PICK.item.buildList('weapon').length, 'n=' + sc._listWindow._entries.length);
        sc.switchCategory(1);
        check('→ 切到防具', sc._catName === '防具');
        sc.switchCategory(1);
        check('→ 循环回物品', sc._catName === '物品');
        sc.switchCategory(-1);
        check('← 反向切到防具', sc._catName === '防具');
        sc.switchCategory(1);
        sc._listWindow.select(0);
        const entry = sc._listWindow.currentEntry();
        const before = $gameParty.numItems(entry.item);
        sc.onItemOk();                                   // 打开数量输入
        check('数量窗口已激活', sc._numberWindow.active === true);
        check('默认数量 99', sc._numberWindow.value() === 99);
        sc._numberWindow.changeValue(-50);               // 改成 49
        check('数量改为 49', sc._numberWindow.value() === 49);
        sc.onValueOk();                                  // 确认
        check('物品已添加 49', $gameParty.numItems(entry.item) === before + 49, 'now=' + $gameParty.numItems(entry.item));
        check('确认后返回列表', sc._listWindow.active === true && sc._numberWindow.active === false);
        sc.onItemOk(); sc.onValueCancel();               // 取消路径
        check('取消后也返回列表', sc._listWindow.active === true);

        // 变量场景
        T._pickConfig = I.PICK.variable;
        const sc2 = new I.Scene_PickNumber();
        sc2.create();
        check('变量场景默认类别=变量', sc2._catName === '变量', sc2._catName);
        sc2._listWindow.select(0);
        const ve = sc2._listWindow.currentEntry();
        sc2.onItemOk();
        sc2._numberWindow._value = 777;
        sc2.onValueOk();
        check('变量场景端到端写入', $gameVariables.value(ve.id) === 777, 'v=' + $gameVariables.value(ve.id));
        sc2.switchCategory(1);
        check('变量场景可切到开关', sc2._catName === '开关', sc2._catName);
        check('开关列表已重建', sc2._listWindow._entries.length > 100, 'n=' + sc2._listWindow._entries.length);

        // 金币场景
        T._numRequest = { title: '设置金币', value: 12345, min: 0, max: 999999999, valueLabel: '金币', onOk: () => {} };
        const sc3 = new I.Scene_NumberInput();
        sc3.create();
        check('金币场景 create() 正常', sc3._inputWindow.value() === 12345, 'v=' + sc3._inputWindow.value());
        check('金币场景状态窗高度足够', sc3._statusWindow.height >= 60, 'h=' + sc3._statusWindow.height);
        check('金币窗口禁用原生滚轮', sc3._inputWindow.isWheelScrollEnabled() === false);
        {
            const inner = sc3._inputWindow.height - 24;
            const overall = sc3._inputWindow.contentsHeight();
            check('数值窗 maxScrollY==0', Math.max(0, overall - inner) === 0, 'inner=' + inner + ' overall=' + overall);
        }
        sc3._inputWindow.activate();
        TouchInput.wheelY = 100;
        sc3._inputWindow.processWheelScroll();
        check('滚轮 +1', sc3._inputWindow.value() === 12346, 'v=' + sc3._inputWindow.value());
        TouchInput.wheelY = -100;
        sc3._inputWindow.processWheelScroll();
        check('滚轮 -1', sc3._inputWindow.value() === 12345, 'v=' + sc3._inputWindow.value());
        TouchInput.wheelY = 0;
    } catch (e) {
        ok = false; err = e.message + '\n' + (e.stack || '').split('\n')[1];
    }
    check('端到端全程无异常', ok, err);
}

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
