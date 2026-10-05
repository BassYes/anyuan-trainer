//=============================================================================
// AnYuan_Trainer.js  —  黯渊崛起 游戏内实时修改器 
//=============================================================================
/*:
 * @target MZ
 * @plugindesc v1.3 黯渊崛起 游戏内实时修改器（F10 或右上角按钮 打开）
 * @author AnYuan Trainer
 * @help
 * ============================================================
 *  打开 / 关闭:
 *     · 按 F10
 *     · 或点右上角「修改器」按钮
 *  操作:  ↑↓ 选择   Z/回车 执行   X/Esc 关闭
 *  ------------------------------------------------
 *  ⚠ 适度使用提醒：修改太强会让游戏很快失去乐趣，
 *    建议优先使用【便利功能】（倍率/加速），少用【一键修改】。
 * ============================================================
 *  便利功能（降肝不毁游戏）:
 *    经验倍率 / 金币倍率 / 掉宝倍率   1x~5x（只影响战斗奖励）
 *    全局倍速 / 战斗加速 / 移动加速 / 不遇敌 / 自动满血 / 无限MP·TP
 *  战斗辅助: 无敌模式 / 一击必杀 / 穿墙
 *  交互式编辑: 添加物品、背包物品数量、设置角色等级、设置金币、
 *              修改变量开关、存档信息
 *  一键修改（⚠ 影响游戏寿命）: 满级、属性、全物品、全技能、图鉴、
 *              宠物、精通、觉醒、任务、礼包码…
 *
 * @param openKeyCode
 * @text 打开热键 keyCode
 * @desc F8=119  F9=120  F10=121  F11=122  F12=123
 * @default 121
 *
 * @param showButton
 * @text 显示右上角按钮
 * @type boolean
 * @default true
 */
(() => {
    'use strict';

    const PLUGIN_NAME = 'AnYuan_Trainer';
    const P = PluginManager.parameters(PLUGIN_NAME) || {};
    const OPEN_KEY = Number(P['openKeyCode'] || 121);
    const SHOW_BUTTON = String(P['showButton']) !== 'false';

    //=========================================================================
    // 训练器状态（不存档，只存在于本次运行）
    //=========================================================================
    const T = (window.AnYuanTrainer = window.AnYuanTrainer || {
        god: false,
        oneHit: false,
        noEncounter: false,
        through: false,
        speed: false,
        infiniteMp: false,
        autoHeal: false,
        gameSpeed: 1,
        battleSpeed: 1,
        expMult: 1,
        goldMult: 1,
        dropMult: 1,
        _suppressInput: false,
        version: '1.3'
    });

    const say = msg => { T.lastMessage = msg; };

    //=========================================================================
    // 从插件参数提取清单（运行时读取，不需要硬编码）
    //=========================================================================
    function params(name) { return PluginManager.parameters(name) || {}; }
    function jsonArr(raw) { try { return JSON.parse(raw); } catch (e) { return []; } }
    function structIds(raw, key) {
        const seen = {};
        const out = [];
        for (const e of jsonArr(raw)) {
            let o = e;
            if (typeof e === 'string') { try { o = JSON.parse(e); } catch (x) { continue; } }
            const id = Number(o && o[key]);
            if (id > 0 && !seen[id]) { seen[id] = true; out.push(id); }
        }
        return out;
    }
    function numIds(raw) {
        const seen = {};
        const out = [];
        for (const n of jsonArr(raw).map(Number)) {
            if (n > 0 && !seen[n]) { seen[n] = true; out.push(n); }
        }
        return out;
    }
    function taskIdsOf(raw) {
        try { return JSON.parse(raw).map(t => String(JSON.parse(t).taskId)); } catch (e) { return []; }
    }
    function structObjs(raw) {
        const out = [];
        for (const e of jsonArr(raw)) {
            if (typeof e === 'string') { try { out.push(JSON.parse(e)); } catch (x) { /* skip */ } }
            else if (e) out.push(e);
        }
        return out;
    }

    const LIST = {
        monsters: () => numIds(params('BZ_MonsterEncyclopedia')['enemyList']),
        skills:   () => structIds(params('BZ_SkillEncyclopedia')['skillList'], 'skillId'),
        states:   () => structIds(params('BZ_StateEncyclopedia')['stateList'], 'stateId'),
        weapons:  () => structIds(params('BZ_EquipEncyclopedia')['weaponList'], 'weaponId'),
        armors:   () => structIds(params('BZ_EquipEncyclopedia')['armorList'], 'armorId'),
        pets:     () => structIds(params('BZ_PetSystem')['petData'], 'actorId'),
        gifts:    () => structObjs(params('BZ_GiftCode')['giftCodes']),
        sectGroups: () => structObjs(params('BZ_SectTaskGroupManager')['groups']),
        taskLists:  () => structObjs(params('BZ_TaskListManager')['taskLists']),
    };

    // 全职业可学技能并集
    function learnableSkills() {
        const set = {};
        for (const c of ($dataClasses || [])) {
            if (!c) continue;
            for (const l of (c.learnings || [])) {
                if (l.skillId > 0 && $dataSkills[l.skillId]) set[l.skillId] = true;
            }
        }
        return Object.keys(set).map(Number).sort((a, b) => a - b);
    }

    function eachPartyActor(fn) {
        const seen = {};
        const all = [];
        const push = a => {
            if (!a) return;
            const id = a.actorId ? a.actorId() : a._actorId;
            if (id == null || seen[id]) return;
            seen[id] = true;
            all.push(a);
        };
        try { ($gameParty.members() || []).forEach(push); } catch (e) { /* ignore */ }
        try { ($gameParty._actors || []).forEach(id => push($gameActors.actor(id))); } catch (e) { /* ignore */ }
        all.forEach(fn);
    }

    //=========================================================================
    // 实时开关的实现 (hooks)
    //=========================================================================
    // ---- 无敌 / 自动满血 / 无限MP-TP ----
    const _Game_Actor_refresh = Game_Actor.prototype.refresh;
    Game_Actor.prototype.refresh = function() {
        _Game_Actor_refresh.call(this);
        if (!T.god && !T.autoHeal && !T.infiniteMp) return;
        if (!$gameParty.members().includes(this)) return;
        if (T.god || T.autoHeal) {
            this._hp = this.mhp;
            this.removeState(this.deathStateId());
        }
        if (T.infiniteMp) {
            this._mp = this.mmp;
            this._tp = this.maxTp();
        }
    };

    // ---- 一击必杀：把对敌人造成的伤害放大到致命 ----
    const _Game_Battler_gainHp = Game_Battler.prototype.gainHp;
    Game_Battler.prototype.gainHp = function(value) {
        if (T.oneHit && value < 0 && this.isEnemy && this.isEnemy()) {
            value = -(this.hp + this.mhp + 999999);
        }
        _Game_Battler_gainHp.call(this, value);
    };

    // ---- 不遇敌 ----
    const _Game_Player_updateEncounterCount = Game_Player.prototype.updateEncounterCount;
    Game_Player.prototype.updateEncounterCount = function() {
        if (T.noEncounter) { this._encounterCount = 999999; return; }
        _Game_Player_updateEncounterCount.call(this);
    };

    // ---- 移动加速 (地图上玩家与随从) ----
    const _Game_CharacterBase_distancePerFrame = Game_CharacterBase.prototype.distancePerFrame;
    Game_CharacterBase.prototype.distancePerFrame = function() {
        const base = _Game_CharacterBase_distancePerFrame.call(this);
        if (T.speed && this.isPlayer && this.isPlayer()) return base * 2;
        if (T.speed && this._followers) return base; // 随从跟随
        return base;
    };

    // ---- 穿墙 ----
    function applyThrough() {
        if ($gamePlayer) $gamePlayer._through = T.through;
        if ($gamePlayer && $gamePlayer._followers) {
            $gamePlayer._followers._data.forEach(f => { if (f) f._through = T.through; });
        }
    }

    //=========================================================================
    // 便利功能：经验 / 金币 / 掉宝 倍率
    //  直接挂在游戏自带的 BZ_ExpAndDropRateBonus 体系上：
    //    expRateBonus() 返回倍率（+100% → 1.0）
    //    dropRateBonus() / goldRateBonus() 返回百分比（+100% → 100）
    //  游戏侧通过 maxExpRate()/maxGoldRate()/maxDropRate() 作用于
    //    Game_Troop.expTotal / goldTotal、Game_Enemy.dropItemRate
    //  因此只影响战斗奖励，不会直接把数值拉满，属于“降肝不毁游戏”的功能。
    //=========================================================================
    function refreshRateCache() {
        try { if ($gameParty && $gameParty.clearRateBonusCache) $gameParty.clearRateBonusCache(); } catch (e) { /* ignore */ }
    }

    if (typeof Game_Actor !== 'undefined' && Game_Actor.prototype.expRateBonus) {
        const _expRateBonus = Game_Actor.prototype.expRateBonus;
        Game_Actor.prototype.expRateBonus = function() {
            let v = _expRateBonus.call(this);
            const m = Number(T.expMult) || 1;
            if (m > 1) v += (m - 1);
            return v;
        };
    }
    if (typeof Game_Actor !== 'undefined' && Game_Actor.prototype.dropRateBonus) {
        const _dropRateBonus = Game_Actor.prototype.dropRateBonus;
        Game_Actor.prototype.dropRateBonus = function() {
            let v = _dropRateBonus.call(this);
            const m = Number(T.dropMult) || 1;
            if (m > 1) v += (m - 1) * 100;
            return v;
        };
    }
    if (typeof Game_Actor !== 'undefined' && Game_Actor.prototype.goldRateBonus) {
        const _goldRateBonus = Game_Actor.prototype.goldRateBonus;
        Game_Actor.prototype.goldRateBonus = function() {
            let v = _goldRateBonus.call(this);
            const m = Number(T.goldMult) || 1;
            if (m > 1) v += (m - 1) * 100;
            return v;
        };
    }

    // 当前生效的获取率（用于展示）
    function currentRates() {
        try {
            const e = $gameParty.maxExpRate ? $gameParty.maxExpRate() : 1;
            const g = $gameParty.maxGoldRate ? $gameParty.maxGoldRate() : 1;
            const d = $gameParty.maxDropRate ? $gameParty.maxDropRate() : 1;
            return '经验 ' + Math.round(e * 100) + '%  金币 ' + Math.round(g * 100) + '%  掉宝 ' + Math.round(d * 100) + '%';
        } catch (err) { return ''; }
    }

    //=========================================================================
    // 倍速 / 战斗加速
    //  原理: 一帧内多次执行 SceneManager.updateMain()，等效于多跑几帧。
    //  注意: Input.update() 会修改输入状态，多次调用会让 isTriggered 永远为 false，
    //        因此额外帧里要「冻结」输入状态，并让 isTriggered/isRepeated/isPressed 返回 false。
    //=========================================================================
    function effectiveSpeed() {
        let n = Math.max(1, Number(T.gameSpeed) || 1);
        const bs = Math.max(1, Number(T.battleSpeed) || 1);
        if (bs > 1 && typeof Scene_Battle !== 'undefined' &&
            SceneManager._scene instanceof Scene_Battle) {
            n = Math.max(n, bs);
        }
        return n;
    }

    const _Input_isTriggered = Input.isTriggered;
    const _Input_isRepeated = Input.isRepeated;
    const _Input_isPressed = Input.isPressed;
    Input.isTriggered = function(keyName) {
        if (T._suppressInput) return false;
        return _Input_isTriggered.call(this, keyName);
    };
    Input.isRepeated = function(keyName) {
        if (T._suppressInput) return false;
        return _Input_isRepeated.call(this, keyName);
    };
    Input.isPressed = function(keyName) {
        if (T._suppressInput) return false;
        return _Input_isPressed.call(this, keyName);
    };

    const _SceneManager_updateMain = SceneManager.updateMain;
    const _Input_update = Input.update;
    const _TouchInput_update = (typeof TouchInput !== 'undefined' && TouchInput) ? TouchInput.update : null;

    SceneManager.updateMain = function() {
        const n = effectiveSpeed();
        if (n <= 1) return _SceneManager_updateMain.call(this);
        try {
            for (let i = 0; i < n; i++) {
                if (i > 0) {
                    T._suppressInput = true;
                    Input.update = function() {};                      // 冻结输入状态
                    if (_TouchInput_update) TouchInput.update = function() {};
                }
                _SceneManager_updateMain.call(this);
            }
        } finally {
            Input.update = _Input_update;
            if (_TouchInput_update) TouchInput.update = _TouchInput_update;
            T._suppressInput = false;
        }
    };

    //=========================================================================
    // 一键功能
    //=========================================================================
    const RUN = {
        gold() {
            $gameParty.gainGold(1000000);
            return '金币 +1,000,000（当前 ' + $gameParty.gold().toLocaleString() + '）';
        },
        maxlevel() {
            let n = 0;
            eachPartyActor(a => { a.changeLevel(a.maxLevel(), false); n++; });
            return n + ' 名角色已满级';
        },
        boost() {
            let n = 0;
            eachPartyActor(a => {
                a._paramPlus = (a._paramPlus || [0, 0, 0, 0, 0, 0, 0, 0]).map(v => (v || 0) + 9999);
                a.recoverAll(); a.refresh(); n++;
            });
            return n + ' 名角色全属性 +9999';
        },
        fullhp() {
            $gameParty.members().forEach(a => { a.recoverAll(); a.refresh(); });
            return '队伍已满血满蓝';
        },
        allitems() {
            let n = 0;
            const give = (item) => {
                if (!item || !item.name || item.name.startsWith('-----')) return;
                $gameParty.gainItem(item, 99, false); n++;
            };
            try { ($dataItems || []).forEach(give); } catch (e) {}
            try { ($dataWeapons || []).forEach(give); } catch (e) {}
            try { ($dataArmors || []).forEach(give); } catch (e) {}
            return '已获得全部物品 x99（' + n + ' 种）';
        },
        learnall() {
            const ids = learnableSkills();
            let n = 0;
            eachPartyActor(a => {
                for (const id of ids) {
                    if (!a.isLearnedSkill(id)) { a.learnSkill(id); n++; }
                }
            });
            return '学会全部职业技能（共 ' + ids.length + ' 个，新增 ' + n + '）';
        },
        unlockall() {
            const S = $gameSystem;
            const c = { monster: 0, skill: 0, state: 0, weapon: 0, armor: 0, pet: 0 };
            if (typeof S.registerEnemy === 'function') {
                LIST.monsters().forEach(id => { if ($dataEnemies[id] && !S.isEnemyRegistered(id)) { S.registerEnemy(id); c.monster++; } });
            }
            if (typeof S.unlockSkillEncy === 'function') {
                LIST.skills().forEach(id => { if ($dataSkills[id] && !S.isSkillEncyUnlocked(id)) { S.unlockSkillEncy(id); c.skill++; } });
            }
            if (typeof S.unlockStateEncy === 'function') {
                LIST.states().forEach(id => { if ($dataStates[id] && !S.isStateEncyUnlocked(id)) { S.unlockStateEncy(id); c.state++; } });
            }
            if (typeof S.unlockEquipEncy === 'function') {
                const w = LIST.weapons(), ar = LIST.armors();
                if (S.beginDeferEquipEncySave) S.beginDeferEquipEncySave();
                w.forEach(id => { if ($dataWeapons[id]) { S.unlockEquipEncy('weapon', id); c.weapon++; } });
                ar.forEach(id => { if ($dataArmors[id]) { S.unlockEquipEncy('armor', id); c.armor++; } });
                if (S.endDeferEquipEncySave) S.endDeferEquipEncySave();
            }
            if (typeof S.bzEncyRegister === 'function') {
                LIST.pets().forEach(id => {
                    if ($dataActors[id] && !(S.bzEncyIsRegistered && S.bzEncyIsRegistered(id))) { S.bzEncyRegister(id); c.pet++; }
                });
            }
            return '图鉴解锁: 怪+' + c.monster + ' 技+' + c.skill + ' 态+' + c.state +
                   ' 武+' + c.weapon + ' 防+' + c.armor + ' 宠+' + c.pet;
        },
        pets() {
            const ids = LIST.pets();
            let n = 0;
            if (typeof $gameParty.mkForceAddPet === 'function') {
                for (const id of ids) { if ($gameParty.mkForceAddPet(id)) n++; }
            } else {
                $gameParty._mkPetRoster = $gameParty._mkPetRoster || [];
                const have = {};
                $gameParty._mkPetRoster.forEach(e => { have[typeof e === 'number' ? e : e._actorId] = true; });
                for (const id of ids) {
                    if (!have[id] && $gameParty._mkPetRoster.length < 40) { $gameParty._mkPetRoster.push(id); n++; }
                }
                if ($gameParty._mkActivatePetIndex === undefined) { /* noop */ }
            }
            return '已加入全部宠物 ' + n + ' 只（当前 ' + ($gameParty._mkPetRoster || []).length + '）';
        },
        mastery() {
            const wp = params('BZ_WeaponMastery');
            const baseExp = Number(wp['baseExp']) || 100;
            const curve = Number(wp['expCurve']) || 1.5;
            const maxLv = Number(wp['maxLevel']) || 99;
            const maxExp = Math.floor(baseExp * Math.pow(maxLv, curve));
            const exclude = numIds(wp['excludeWtypeIds']);
            const skillMax = Number(params('BZ_SkillMastery')['maxMasteryLevel']) || 10;
            const wt = [];
            for (let i = 1; i < ($dataSystem.weaponTypes || []).length; i++) {
                if (!exclude.includes(i)) wt.push(i);
            }
            let ws = 0, ss = 0;
            eachPartyActor(a => {
                a._weaponMastery = a._weaponMastery || {};
                wt.forEach(t => { a._weaponMastery[t] = maxExp; ws++; });
                a._skillMastery = a._skillMastery || {};
                (a._skills || []).forEach(sid => { a._skillMastery[sid] = { level: skillMax, exp: 0 }; ss++; });
            });
            return '精通拉满: 武器 ' + wt.length + ' 类(Lv' + maxLv + ')、技能 ' + ss + ' 个(Lv' + skillMax + ')';
        },
        awaken() {
            let n = 0;
            eachPartyActor(a => { a._awakenGauge = 100; n++; });
            return n + ' 名角色觉醒值拉满 (100)';
        },
        tasklist() {
            const S = $gameSystem;
            S._bzTaskListData = S._bzTaskListData || {};
            let msg = [];
            for (const l of LIST.taskLists()) {
                const ids = taskIdsOf(l.tasks);
                S._bzTaskListData[String(l.listId)] = { activeTasks: [], completedTasks: ids, killProgress: {} };
                msg.push(l.listName + ':' + ids.length);
                if (Number(l.scoreVarId) > 0) $gameVariables.setValue(Number(l.scoreVarId), 999999);
            }
            if ($dataSystem.variables && $dataSystem.variables[67]) $gameVariables.setValue(67, 99);
            return '冒险者任务完成 (' + msg.join(' ') + ') + 积分/等级拉满';
        },
        secttask() {
            const S = $gameSystem;
            S._bzSectTaskData = S._bzSectTaskData || {};
            let n = 0;
            for (const g of LIST.sectGroups()) {
                S._bzSectTaskData[g.groupId] = { activeTaskId: '', completedTaskIds: taskIdsOf(g.tasks) };
                n++;
            }
            return '门派日常任务标记完成 (' + n + ' 个门派)';
        },
        giftreset() {
            $gameSystem._bzGiftCodeClaimed = {};
            return '礼包码领取记录已重置（可在游戏菜单「礼包码」重新兑换）';
        },
        shoplimit() {
            $gameSystem._bzShopPurchaseLimitCounts = {};
            return '商店限购已清除';
        },
        unlockequip() {
            $gameSystem._lockedEquips = {};
            return '装备锁定已清除';
        },
        clearnew() {
            $gameParty._newItemsList = [];
            return '"新物品"红点已清除';
        },
        cheatall() {
            const parts = ['gold', 'maxlevel', 'boost', 'allitems', 'learnall', 'mastery',
                'unlockall', 'pets', 'awaken', 'tasklist', 'secttask',
                'shoplimit', 'unlockequip', 'clearnew', 'giftreset', 'fullhp'];
            let ok = 0;
            for (const k of parts) {
                try { RUN[k](); ok++; } catch (e) { /* 跳过失败项 */ }
            }
            return '★ 一键全解锁完成（' + ok + '/' + parts.length + ' 项）';
        },
    };

    //=========================================================================
    // 命令表（按分组排列；kind:'header' 为不可选的分组标题）
    //=========================================================================
    const H = name => ({ kind: 'header', name });
    const W = '\u26a0';

    const CMDS = [
        H('【便利功能】降肝不毁游戏，推荐优先用这些'),
        { sym: 'expMult', name: '经验倍率', kind: 'cycle', values: [1, 2, 3, 5], labels: ['1x', '2x', '3x', '5x'], apply: refreshRateCache, desc: '战斗获得经验 ×N（只影响战斗奖励，保留成长乐趣）' },
        { sym: 'goldMult', name: '金币倍率', kind: 'cycle', values: [1, 2, 3, 5], labels: ['1x', '2x', '3x', '5x'], apply: refreshRateCache, desc: '战斗获得金币 ×N（只影响战斗奖励）' },
        { sym: 'dropMult', name: '掉宝倍率', kind: 'cycle', values: [1, 2, 3, 5], labels: ['1x', '2x', '3x', '5x'], apply: refreshRateCache, desc: '战利品掉率 ×N（只影响战斗奖励）' },
        { sym: 'gameSpeed', name: '全局倍速', kind: 'cycle', values: [1, 2, 3, 4], labels: ['1x', '2x', '3x', '4x'], desc: '地图/战斗/动画整体加速（1x 为正常速度）' },
        { sym: 'battleSpeed', name: '战斗加速', kind: 'cycle', values: [1, 2, 3, 4], labels: ['1x', '2x', '3x', '4x'], desc: '仅战斗中加速（与全局倍速取较大值）' },
        { sym: 'speed', name: '移动加速', kind: 'toggle', desc: '地图移动速度 x2' },
        { sym: 'noEncounter', name: '不遇敌', kind: 'toggle', desc: '地图上不触发随机战斗' },
        { sym: 'autoHeal', name: '自动满血', kind: 'toggle', desc: '队伍成员始终保持满血' },
        { sym: 'infiniteMp', name: '无限MP/TP', kind: 'toggle', desc: 'MP、TP 保持全满' },

        H('【战斗辅助】'),
        { sym: 'god', name: '无敌模式', kind: 'toggle', desc: '队伍成员不会掉血、不会死亡' },
        { sym: 'oneHit', name: '一击必杀', kind: 'toggle', desc: '我方造成伤害时敌人立即死亡' },
        { sym: 'through', name: '穿墙', kind: 'toggle', desc: '角色可穿过障碍物', apply: applyThrough },

        H('【交互式编辑】逐项查看并修改'),
        { sym: 'giveItem', name: '添加物品…', kind: 'scene', pick: 'item', desc: '浏览全部物品/武器/防具，输入数量添加' },
        { sym: 'ownItem', name: '背包物品数量…', kind: 'scene', pick: 'ownedItem', desc: '只列出已拥有的物品，直接设为指定数量（设为0即移除）' },
        { sym: 'setLevel', name: '设置角色等级…', kind: 'scene', pick: 'actorLevel', desc: '选择队伍角色并设定等级' },
        { sym: 'setGold', name: '设置金币…', kind: 'gold', desc: '输入精确金币数量' },
        { sym: 'setVar', name: '修改变量/开关…', kind: 'scene', pick: 'variable', desc: '选择变量或开关并修改数值' },
        { sym: 'saveInfo', name: '存档信息', kind: 'info', desc: '显示金币/队伍/时长/获取率等信息' },

        H('【一键修改】' + W + ' 使用过度会明显降低游戏乐趣'),
        { sym: 'gold', name: '金币 +100万' + W, run: () => RUN.gold(), warn: true, desc: '立即增加 1,000,000 金币' },
        { sym: 'maxlevel', name: '队伍满级' + W, run: () => RUN.maxlevel(), warn: true, desc: '队伍全员升到等级上限（会跳过成长过程）' },
        { sym: 'boost', name: '属性拉满 +9999' + W, run: () => RUN.boost(), warn: true, desc: '全员全属性 +9999 并回满（会让战斗失去难度）' },
        { sym: 'allitems', name: '全物品 x99' + W, run: () => RUN.allitems(), warn: true, desc: '获得全部物品/武器/防具' },
        { sym: 'learnall', name: '学会全部技能' + W, run: () => RUN.learnall(), warn: true, desc: '全员学会所有职业技能' },
        { sym: 'mastery', name: '精通拉满' + W, run: () => RUN.mastery(), warn: true, desc: '武器与技能精通满级' },
        { sym: 'fullhp', name: '满血满蓝', run: () => RUN.fullhp(), desc: '队伍全体 HP/MP 全满' },
        { sym: 'unlockall', name: '图鉴全解锁', run: () => RUN.unlockall(), desc: '怪物/技能/状态/装备/宠物图鉴' },
        { sym: 'pets', name: '加入全部宠物', run: () => RUN.pets(), desc: '全部宠物加入宠物栏' },
        { sym: 'awaken', name: '觉醒值拉满', run: () => RUN.awaken(), desc: '全员觉醒值 100' },
        { sym: 'tasklist', name: '冒险者任务完成', run: () => RUN.tasklist(), desc: '任务全完成 + 积分/等级拉满' },
        { sym: 'secttask', name: '门派日常完成', run: () => RUN.secttask(), desc: '四门派日常任务标记完成' },
        { sym: 'shoplimit', name: '清商店限购', run: () => RUN.shoplimit(), desc: '清除商店购买次数限制' },
        { sym: 'unlockequip', name: '清装备锁', run: () => RUN.unlockequip(), desc: '解除装备锁定' },
        { sym: 'clearnew', name: '清新物品红点', run: () => RUN.clearnew(), desc: '清除背包“新”标记' },
        { sym: 'giftreset', name: '重置礼包码', run: () => RUN.giftreset(), desc: '可重新兑换全部礼包码' },
        { sym: 'cheatall', name: '★ 一键全解锁' + W + W, run: () => RUN.cheatall(), warn: true, desc: '执行全部一键功能（强烈建议先备份存档）' },
    ];

    //=========================================================================
    // 界面: 状态窗口
    //=========================================================================
    function Window_CheatStatus() { this.initialize(...arguments); }
    Window_CheatStatus.prototype = Object.create(Window_Base.prototype);
    Window_CheatStatus.prototype.constructor = Window_CheatStatus;
    Window_CheatStatus.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._message = '';
        this.refresh();
    };
    // 只在内容变化时重绘，避免每帧刷新
    Window_CheatStatus.prototype.setMessage = function(m) {
        m = m || '';
        if (this._message === m) return;
        this._message = m;
        this.refresh();
    };
    // 第二行（操作提示），可选
    Window_CheatStatus.prototype.setSubMessage = function(m) {
        m = m || '';
        if (this._message2 === m) return;
        this._message2 = m;
        this.refresh();
    };
    Window_CheatStatus.prototype.refresh = function() {
        this.contents.clear();
        const w = this.contentsWidth();
        this.changeTextColor(ColorManager.systemColor());
        this.drawText('AnYuan Trainer', 0, 0, 170);
        this.resetTextColor();
        this.drawText(this._message || '', 178, 0, Math.max(0, w - 178));
        if (this._message2) {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(this._message2, 0, 36, w);
            this.resetTextColor();
        }
    };

    //=========================================================================
    // 界面: 命令窗口
    //=========================================================================
    function Window_CheatCommand() { this.initialize(...arguments); }
    Window_CheatCommand.prototype = Object.create(Window_Command.prototype);
    Window_CheatCommand.prototype.constructor = Window_CheatCommand;
    Window_CheatCommand.prototype.numVisibleRows = function() { return 12; };
    Window_CheatCommand.prototype.maxCols = function() { return 1; };
    // 分组标题行不可选
    Window_CheatCommand.prototype.isCommandEnabled = function(index) {
        const c = CMDS[index];
        return !!(c && c.kind !== 'header');
    };
    // 把光标吸附到最近的可选项（跳过 header）
    Window_CheatCommand.prototype.select = function(index) {
        const n = this.maxItems();
        if (n <= 0) return;
        const last = this._index;
        let dir = (last === undefined || last < 0 || index >= last) ? 1 : -1;
        let i = Math.max(0, Math.min(n - 1, index));
        let guard = 0;
        while (i >= 0 && i < n && CMDS[i] && CMDS[i].kind === 'header' && guard++ <= n) i += dir;
        if (i < 0 || i >= n) {
            i = Math.max(0, Math.min(n - 1, index));
            dir = -dir;
            guard = 0;
            while (i >= 0 && i < n && CMDS[i] && CMDS[i].kind === 'header' && guard++ <= n) i += dir;
        }
        if (i < 0 || i >= n) i = Math.max(0, Math.min(n - 1, index));
        Window_Selectable.prototype.select.call(this, i);
    };
    // 只处理上/下与翻页；左/右留给 Scene 用于切换开关/倍速
    Window_CheatCommand.prototype.processCursorMove = function() {
        if (this.isCursorMovable()) {
            const lastIndex = this.index();
            if (Input.isRepeated('down')) this.cursorDown(Input.isTriggered('down'));
            if (Input.isRepeated('up')) this.cursorUp(Input.isTriggered('up'));
            if (!this.isHandled('pagedown') && Input.isTriggered('pagedown')) this.cursorPagedown();
            if (!this.isHandled('pageup') && Input.isTriggered('pageup')) this.cursorPageup();
            if (this.index() !== lastIndex) this.playCursorSound();
        }
    };
    Window_CheatCommand.prototype.makeCommandList = function() {
        for (const c of CMDS) this.addCommand(c.name, c.sym || c.name, c.kind !== 'header');
    };
    Window_CheatCommand.prototype.drawItem = function(index) {
        const c = CMDS[index];
        if (!c) return;
        const rect = this.itemLineRect(index);
        if (c.kind === 'header') {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(c.name, rect.x, rect.y, rect.width, 'left');
            return;
        }
        this.resetTextColor();
        let right = '';
        let on = false;
        if (c.kind === 'toggle') { on = !!T[c.sym]; right = on ? '● 开' : '○ 关'; }
        else if (c.kind === 'cycle') {
            const i = c.values.indexOf(Number(T[c.sym]));
            right = c.labels[i >= 0 ? i : 0];
            on = i > 0;
        }
        if (c.warn) this.changeTextColor(ColorManager.textColor(17));   // ⚠ 提醒色
        this.drawText(c.name, rect.x, rect.y, rect.width - 84, 'left');
        this.resetTextColor();
        if (right) {
            this.changeTextColor(on ? ColorManager.powerUpColor() : ColorManager.normalColor());
            this.drawText(right, rect.x + rect.width - 90, rect.y, 90, 'right');
            this.resetTextColor();
        }
    };

    //=========================================================================
    // 界面: 修改器场景
    //=========================================================================
    function Scene_Cheat() { this.initialize(...arguments); }
    Scene_Cheat.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_Cheat.prototype.constructor = Scene_Cheat;

    Scene_Cheat.prototype.helpWindowRect = function() {
        return new Rectangle(0, Graphics.boxHeight - 96, Graphics.boxWidth, 96);
    };

    Scene_Cheat.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        const w = Graphics.boxWidth;
        const h = Graphics.boxHeight;
        this._statusWindow = new Window_CheatStatus(new Rectangle(0, 0, w, 96));
        this.addWindow(this._statusWindow);
        this._statusWindow.setSubMessage(W + ' 适度使用：改太狠会让游戏很快失去乐趣，建议优先用【便利功能】');
        this._commandWindow = new Window_CheatCommand(new Rectangle(0, 96, w, h - 96 - 96));
        this._commandWindow.setHandler('ok', this.onCommandOk.bind(this));
        this._commandWindow.setHandler('cancel', this.popScene.bind(this));
        this.addWindow(this._commandWindow);
        this._commandWindow.activate();
        this.updateHelp();
    };

    Scene_Cheat.prototype.updateHelp = function() {
        if (!this._helpWindow) return;
        const c = CMDS[this._commandWindow.index()];
        const base = c ? (c.desc || c.name) : '↑↓ 选择, ←→/Z 执行, X/Esc/F10 关闭';
        this._helpWindow.setText(c && c.warn ? (W + ' 影响游戏寿命 — ' + base) : base);
    };

    Scene_Cheat.prototype.onCommandOk = function() {
        const sym = this._commandWindow.currentSymbol();
        const c = CMDS.find(x => x.sym === sym);
        if (!c) return;
        if (c.kind === 'toggle') {
            T[sym] = !T[sym];
            try { if (c.apply) c.apply(); } catch (e) { /* ignore */ }
            this._statusWindow.setMessage(c.name + ' → ' + (T[sym] ? '开启' : '关闭'));
        } else if (c.kind === 'cycle') {
            const cur = c.values.indexOf(Number(T[sym]));
            const ni = (cur + 1) % c.values.length;
            T[sym] = c.values[ni];
            try { if (c.apply) c.apply(); } catch (e) { /* ignore */ }
            this._statusWindow.setMessage(c.name + ' → ' + c.labels[ni]);
        } else if (c.kind === 'scene') {
            try {
                T._pickConfig = PICK[c.pick];
                SceneManager.push(Scene_PickNumber);
            } catch (e) {
                this._statusWindow.setMessage('打开失败: ' + (e && e.message ? e.message : e));
            }
        } else if (c.kind === 'gold') {
            const msgWin = this._statusWindow;
            T._numRequest = {
                title: '设置金币',
                value: $gameParty.gold(),
                min: 0,
                max: 999999999,
                valueLabel: '金币',
                onOk: v => {
                    $gameParty.gainGold(v - $gameParty.gold());
                    msgWin.setMessage('金币 → ' + Number(v).toLocaleString());
                },
            };
            SceneManager.push(Scene_NumberInput);
        } else if (c.kind === 'info') {
            this._statusWindow.setMessage(infoText());
        } else {
            try {
                const msg = c.run ? c.run() : '（无）';
                this._statusWindow.setMessage(c.warn ? (msg + '\n' + W + ' 提醒：改得太强会让游戏很快没意思，建议适度使用') : msg);
            } catch (e) {
                this._statusWindow.setMessage('执行出错: ' + (e && e.message ? e.message : e));
            }
        }
        this._commandWindow.refresh();
        this._commandWindow.activate();
        this.updateHelp();
    };

    Scene_Cheat.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        this._frames = (this._frames || 0) + 1;
        if (this._frames <= 3) { this.updateHelp(); return; }
        if (Input.isTriggered('anyuanTrainer')) { this.popScene(); return; }
        // ←→ 只对「开关 / 倍速」类命令生效，避免误触执行“一键”类动作
        if (Input.isTriggered('left') || Input.isTriggered('right')) {
            const c = CMDS[this._commandWindow.index()];
            if (c && (c.kind === 'toggle' || c.kind === 'cycle')) this.onCommandOk();
        }
        this.updateHelp();
    };

    //=========================================================================
    // 存档信息
    //=========================================================================
    function infoText() {
        const g = $gameParty.gold().toLocaleString();
        const party = $gameParty.members().map(a => (a._name || '?') + ' Lv' + (a._level || '?')).join(', ');
        const t = ($gameSystem.playtimeText ? $gameSystem.playtimeText() : '');
        const itemN = Object.keys($gameParty._items || {}).length;
        const petN = ($gameParty._mkPetRoster || []).length;
        let s = '金币 ' + g + '  |  时长 ' + t + '  |  队伍 ' + party + '  |  背包 ' + itemN + ' 种  |  宠物 ' + petN;
        const rates = currentRates();
        if (rates) s += '  |  ' + rates;
        return s;
    }

    //=========================================================================
    // 通用「列表 + 数值」配置（供 Scene_PickNumber 使用）
    //=========================================================================
    const PICK = {
        // ---- 添加物品 ----
        item: {
            title: '添加物品',
            categories: [
                { name: '物品', sym: 'item' },
                { name: '武器', sym: 'weapon' },
                { name: '防具', sym: 'armor' },
            ],
            buildList(sym) {
                const src = sym === 'item' ? $dataItems : sym === 'weapon' ? $dataWeapons : $dataArmors;
                const out = [];
                for (const it of (src || [])) {
                    if (!it || !it.name || it.name.startsWith('-----')) continue;
                    out.push({
                        id: it.id,
                        name: it.name,
                        item: it,
                        sub: () => '持有 ' + $gameParty.numItems(it),
                    });
                }
                return out;
            },
            valueLabel: '数量', initial: 99, min: 1, max: 999,
            confirm(e, v) { $gameParty.gainItem(e.item, v, false); },
            resultText(e, v) {
                return '获得 ' + e.name + ' ×' + v + '（现有 ' + $gameParty.numItems(e.item) + '）';
            },
        },
        // ---- 设置角色等级 ----
        actorLevel: {
            title: '设置角色等级',
            categories: [{ name: '队伍角色', sym: 'party' }],
            buildList() {
                const out = [];
                eachPartyActor(a => out.push({
                    id: a.actorId(),
                    name: (a._name || ('角色' + a.actorId())),
                    actor: a,
                    sub: () => 'Lv ' + (a._level || 1) + ' / ' + a.maxLevel(),
                }));
                return out;
            },
            valueLabel: '等级', initial: 1, min: 1, max: 99,
            confirm(e, v) {
                const lv = Math.min(Math.max(1, v), e.actor.maxLevel());
                e.actor.changeLevel(lv, false);
                e.actor.recoverAll();
                e.actor.refresh();
            },
            resultText(e) { return e.name + ' → Lv ' + (e.actor._level || 1); },
        },
        // ---- 修改背包已有物品数量 ----
        ownedItem: {
            title: '修改背包物品数量',
            categories: [
                { name: '物品', sym: 'item' },
                { name: '武器', sym: 'weapon' },
                { name: '防具', sym: 'armor' },
            ],
            buildList(sym) {
                const map = sym === 'item' ? $gameParty._items
                    : sym === 'weapon' ? $gameParty._weapons : $gameParty._armors;
                const src = sym === 'item' ? $dataItems
                    : sym === 'weapon' ? $dataWeapons : $dataArmors;
                const out = [];
                for (const k of Object.keys(map || {})) {
                    const id = Number(k);
                    const it = src[id];
                    if (!it || !it.name || it.name.startsWith('-----')) continue;
                    if ($gameParty.numItems(it) <= 0) continue;
                    out.push({
                        id, name: it.name, item: it,
                        sub: () => '持有 ' + $gameParty.numItems(it),
                    });
                }
                out.sort((a, b) => a.id - b.id);
                return out;
            },
            valueLabel: '设为', initial: 1, min: 0, max: 9999,
            confirm(e, v) {
                const cur = $gameParty.numItems(e.item);
                if (v > cur) $gameParty.gainItem(e.item, v - cur, false);
                else if (v < cur) $gameParty.gainItem(e.item, -(cur - v), true);
            },
            resultText(e, v) { return e.name + ' → ' + v + ' 个'; },
        },
        // ---- 修改变量 / 开关 ----
        variable: {
            title: '修改变量 / 开关',
            categories: [
                { name: '变量', sym: 'var' },
                { name: '开关', sym: 'switch' },
            ],
            buildList(sym) {
                const out = [];
                if (sym === 'var') {
                    const names = $dataSystem.variables || [];
                    for (let i = 1; i < names.length; i++) {
                        if (!names[i] || names[i] === '-----') continue;
                        out.push({
                            id: i, name: '[' + i + '] ' + names[i], kind: 'var',
                            sub: () => '= ' + $gameVariables.value(i),
                        });
                    }
                } else {
                    const names = $dataSystem.switches || [];
                    for (let i = 1; i < names.length; i++) {
                        if (!names[i]) continue;
                        out.push({
                            id: i, name: '[' + i + '] ' + names[i], kind: 'switch',
                            sub: () => (($gameSwitches && $gameSwitches.value(i)) ? 'ON' : 'OFF'),
                        });
                    }
                }
                return out;
            },
            valueLabel: '数值', initial: 0, min: -999999, max: 999999,
            confirm(e, v) {
                if (e.kind === 'switch') { if ($gameSwitches) $gameSwitches.setValue(e.id, !!v); }
                else $gameVariables.setValue(e.id, v);
            },
            resultText(e, v) {
                return e.kind === 'switch' ? (e.name + ' → ' + (v ? 'ON' : 'OFF')) : (e.name + ' → ' + v);
            },
        },
    };

    //=========================================================================
    // 界面: 分页列表（避免超长位图）
    //   操作: ↑↓ 选择 / Q W 翻页 / 滚轮翻页 / ←→ 由 Scene 切换类别
    //=========================================================================
    function Window_PickList() { this.initialize(...arguments); }
    Window_PickList.prototype = Object.create(Window_Selectable.prototype);
    Window_PickList.prototype.constructor = Window_PickList;
    Window_PickList.prototype.initialize = function(rect) {
        this._perPage = Math.max(1, Math.floor((rect.height - 24) / 36));
        Window_Selectable.prototype.initialize.call(this, rect);
        this._entries = [];
        this._pageEntries = [];
        this._page = 0;
    };
    Window_PickList.prototype.itemHeight = function() { return 36; };
    // 内容高度 = 每页行数×行高，<= 可视高度；这样 maxScrollY()==0，
    // ensureCursorVisible() 无法滚动内容，选中框永远不会错位/超出。
    Window_PickList.prototype.contentsHeight = function() { return this._perPage * this.itemHeight(); };
    Window_PickList.prototype.maxItems = function() { return (this._pageEntries || []).length; };
    // 禁止原生滚轮滚动（它只滚内容不换页，会导致选中框错位/跑到窗口外）
    Window_PickList.prototype.isWheelScrollEnabled = function() { return false; };
    Window_PickList.prototype.setEntries = function(entries) {
        this._entries = entries || [];
        this._page = 0;
        this.updatePage();
    };
    Window_PickList.prototype.pageCount = function() {
        return Math.max(1, Math.ceil(this._entries.length / this._perPage));
    };
    Window_PickList.prototype.updatePage = function() {
        const s = this._page * this._perPage;
        this._pageEntries = this._entries.slice(s, s + this._perPage);
        this.scrollTo(0, 0);      // 先归零滚动，再重绘（topIndex 依赖 _scrollY）
        this.refresh();
        this.select(0);
    };
    Window_PickList.prototype.pageDown = function() {
        if (this._page < this.pageCount() - 1) { this._page++; this.updatePage(); }
    };
    Window_PickList.prototype.pageUp = function() {
        if (this._page > 0) { this._page--; this.updatePage(); }
    };
    Window_PickList.prototype.currentEntry = function() { return this._pageEntries[this.index()]; };
    Window_PickList.prototype.processCursorMove = function() {
        if (this.isCursorMovable()) {
            const lastIndex = this.index();
            if (Input.isRepeated('down')) this.cursorDown(Input.isTriggered('down'));
            if (Input.isRepeated('up')) this.cursorUp(Input.isTriggered('up'));
            if (Input.isRepeated('pagedown')) this.pageDown();
            if (Input.isRepeated('pageup')) this.pageUp();
            if (this.index() !== lastIndex) this.playCursorSound();
        }
    };
    Window_PickList.prototype.processWheelScroll = function() {
        if (!this.active || !this.isTouchedInsideFrame()) return;
        const threshold = 20;
        if (TouchInput.wheelY >= threshold) this.pageDown();
        if (TouchInput.wheelY <= -threshold) this.pageUp();
    };
    Window_PickList.prototype.drawItem = function(index) {
        const e = this._pageEntries[index];
        if (!e) return;
        const rect = this.itemLineRect(index);
        if (e.item) this.drawItemName(e.item, rect.x, rect.y, rect.width - 190);
        else this.drawText(e.name, rect.x, rect.y, rect.width - 190, 'left');
        const sub = e.sub ? e.sub() : '';
        if (sub) {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(sub, rect.x + rect.width - 190, rect.y, 190, 'right');
            this.resetTextColor();
        }
    };

    //=========================================================================
    // 界面: 数值输入（可复用）
    //=========================================================================
    function Window_ValueInput() { this.initialize(...arguments); }
    Window_ValueInput.prototype = Object.create(Window_Selectable.prototype);
    Window_ValueInput.prototype.constructor = Window_ValueInput;
    Window_ValueInput.prototype.initialize = function(rect) {
        this._perPage = 3;
        Window_Selectable.prototype.initialize.call(this, rect);
        this._cfg = null; this._entry = null; this._value = 0;
    };
    Window_ValueInput.prototype.itemHeight = function() { return 36; };
    Window_ValueInput.prototype.contentsHeight = function() { return 3 * 36; };
    Window_ValueInput.prototype.maxItems = function() { return 1; };
    Window_ValueInput.prototype.isWheelScrollEnabled = function() { return false; };
    Window_ValueInput.prototype.setup = function(cfg, entry) {
        this._cfg = cfg; this._entry = entry;
        this._value = Math.min(cfg.max, Math.max(cfg.min, cfg.initial === undefined ? cfg.min : cfg.initial));
        this.refresh();
    };
    Window_ValueInput.prototype.setupSingle = function(req) {
        this._cfg = {
            valueLabel: req.valueLabel || '数值',
            min: req.min === undefined ? 0 : req.min,
            max: req.max === undefined ? 999999999 : req.max,
        };
        this._entry = { name: req.title || '输入数值', sub: () => '' };
        this._value = Math.min(this._cfg.max, Math.max(this._cfg.min, Number(req.value) || 0));
        this.refresh();
    };
    Window_ValueInput.prototype.value = function() { return this._value; };
    Window_ValueInput.prototype.changeValue = function(d) {
        const c = this._cfg || { min: 0, max: 999 };
        this._value = Math.min(c.max, Math.max(c.min, this._value + d));
        this.refresh();
    };
    Window_ValueInput.prototype.refresh = function() {
        this.contents.clear();
        if (!this._cfg) return;
        const w = this.contentsWidth();
        const item = this._entry && this._entry.item;
        if (item) this.drawItemName(item, 0, 0, w);
        else this.drawText((this._entry && this._entry.name) || '', 0, 0, w, 'left');
        this.changeTextColor(ColorManager.powerUpColor());
        this.drawText((this._cfg.valueLabel || '数值') + ':  ' + this._value, 0, 44, w, 'center');
        this.resetTextColor();
        const sub = (this._entry && this._entry.sub) ? this._entry.sub() : '';
        if (sub) this.drawText('当前: ' + sub, 0, 80, w, 'center');
    };
    Window_ValueInput.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        if (!this.active) return;
        if (Input.isRepeated('right')) this.changeValue(1);
        if (Input.isRepeated('left')) this.changeValue(-1);
        if (Input.isRepeated('up')) this.changeValue(10);
        if (Input.isRepeated('down')) this.changeValue(-10);
        if (Input.isRepeated('pagedown')) this.changeValue(100);
        if (Input.isRepeated('pageup')) this.changeValue(-100);
    };
    Window_ValueInput.prototype.processWheelScroll = function() {
        if (!this.active || !this.isTouchedInsideFrame()) return;
        const threshold = 20;
        if (TouchInput.wheelY >= threshold) this.changeValue(1);
        if (TouchInput.wheelY <= -threshold) this.changeValue(-1);
    };

    //=========================================================================
    // 场景: 列表选一项 → 输入数值（无独立类别窗口，←→ 直接切换类别）
    //=========================================================================
    function Scene_PickNumber() { this.initialize(...arguments); }
    Scene_PickNumber.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_PickNumber.prototype.constructor = Scene_PickNumber;

    Scene_PickNumber.prototype.helpWindowRect = function() {
        return new Rectangle(0, Graphics.boxHeight - 96, Graphics.boxWidth, 96);
    };

    // 本场景不用独立帮助窗口：提示直接放在状态栏第二行，把空间留给列表
    Scene_PickNumber.prototype.createHelpWindow = function() {};

    Scene_PickNumber.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        const cfg = T._pickConfig || PICK.item;
        this._cfg = cfg;
        this._catIndex = 0;
        const w = Graphics.boxWidth, h = Graphics.boxHeight;

        this._statusWindow = new Window_CheatStatus(new Rectangle(0, 0, w, 96));
        this.addWindow(this._statusWindow);
        this._statusWindow.setSubMessage('↑↓选择   ←→切类别   Q/W或滚轮翻页   Z选定   X返回');

        const listY = 96;
        const numH = 180;
        this._listWindow = new Window_PickList(new Rectangle(0, listY, w, h - listY));
        this._listWindow.setHandler('ok', this.onItemOk.bind(this));
        this._listWindow.setHandler('cancel', this.popScene.bind(this));
        this.addWindow(this._listWindow);

        this._numberWindow = new Window_ValueInput(new Rectangle(Math.floor(w / 2) - 230, Math.floor(h / 2) - numH / 2, 460, numH));
        this._numberWindow.setHandler('ok', this.onValueOk.bind(this));
        this._numberWindow.setHandler('cancel', this.onValueCancel.bind(this));
        this._numberWindow.hide();
        this.addWindow(this._numberWindow);

        this.loadCategory();
    };

    Scene_PickNumber.prototype.loadCategory = function() {
        const cats = this._cfg.categories || [];
        if (cats.length > 0) {
            if (this._catIndex < 0) this._catIndex = cats.length - 1;
            if (this._catIndex >= cats.length) this._catIndex = 0;
        }
        const cat = cats[this._catIndex] || { name: '', sym: '' };
        this._catName = cat.name;
        this._listWindow.setEntries(this._cfg.buildList(cat.sym));
        this._listWindow.activate();
        this.updateStatus();
    };

    Scene_PickNumber.prototype.switchCategory = function(dir) {
        const cats = this._cfg.categories || [];
        if (cats.length <= 1) return;
        this._catIndex += dir;
        this.loadCategory();
    };

    Scene_PickNumber.prototype.updateStatus = function() {
        const cats = this._cfg.categories || [];
        const lw = this._listWindow;
        let s = this._cfg.title;
        if (cats.length > 1) s += ' 【' + (this._catName || '') + '】←→切换类别';
        else if (this._catName) s += ' 【' + this._catName + '】';
        s += '   共 ' + lw._entries.length + ' 项   第 ' + (lw._page + 1) + '/' + lw.pageCount() + ' 页';
        this._statusWindow.setMessage(s);
    };

    Scene_PickNumber.prototype.onItemOk = function() {
        const e = this._listWindow.currentEntry();
        if (!e) return;
        this._picked = e;
        this._numberWindow.setup(this._cfg, e);
        this._numberWindow.show();
        this._numberWindow.activate();
        this._listWindow.deactivate();
    };

    Scene_PickNumber.prototype.onValueOk = function() {
        const v = this._numberWindow.value();
        const e = this._picked;
        try { this._cfg.confirm(e, v); } catch (err) { console.error(err); }
        this._statusWindow.setMessage(this._cfg.resultText ? this._cfg.resultText(e, v) : '完成');
        this._numberWindow.hide();
        this._numberWindow.deactivate();
        this._listWindow.refresh();
        this._listWindow.activate();
    };

    Scene_PickNumber.prototype.onValueCancel = function() {
        this._numberWindow.hide();
        this._numberWindow.deactivate();
        this._listWindow.activate();
    };

    Scene_PickNumber.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        if (Input.isTriggered('anyuanTrainer')) {
            if (this._numberWindow && this._numberWindow.active) this.onValueCancel();
            else this.popScene();
            return;
        }
        if (this._numberWindow && this._numberWindow.active) {
            this._statusWindow.setSubMessage('←→ ±1   ↑↓ ±10   Q/W ±100   滚轮 ±1    Z/回车 确认   X/Esc 返回');
            return;
        }
        this._statusWindow.setSubMessage('↑↓选择   ←→切类别   Q/W或滚轮翻页   Z选定   X返回');
        if (this._listWindow.active) {
            // ←→ 直接切换类别（无需 Esc）
            if (Input.isTriggered('left')) this.switchCategory(-1);
            else if (Input.isTriggered('right')) this.switchCategory(1);
            this.updateStatus();
        }
    };

    //=========================================================================
    // 场景: 单纯的数值输入（如设置金币）
    //=========================================================================
    function Scene_NumberInput() { this.initialize(...arguments); }
    Scene_NumberInput.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_NumberInput.prototype.constructor = Scene_NumberInput;

    Scene_NumberInput.prototype.helpWindowRect = function() {
        return new Rectangle(0, Graphics.boxHeight - 96, Graphics.boxWidth, 96);
    };

    Scene_NumberInput.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        const req = T._numRequest || { title: '输入数值', value: 0, min: 0, max: 999999999 };
        const w = Graphics.boxWidth, h = Graphics.boxHeight;
        this._statusWindow = new Window_CheatStatus(new Rectangle(0, 0, w, 64));
        this.addWindow(this._statusWindow);
        this._statusWindow.setMessage(req.title || '输入数值');

        this._inputWindow = new Window_ValueInput(new Rectangle(Math.floor(w / 2) - 230, Math.floor(h / 2) - 90, 460, 180));
        this._inputWindow.setupSingle(req);
        this._inputWindow.setHandler('ok', this.onOk.bind(this));
        this._inputWindow.setHandler('cancel', this.onCancel.bind(this));
        this.addWindow(this._inputWindow);
        this._inputWindow.activate();
    };

    Scene_NumberInput.prototype.onOk = function() {
        const v = this._inputWindow.value();
        const req = T._numRequest;
        T._numRequest = null;
        this.popScene();
        if (req && req.onOk) { try { req.onOk(v); } catch (e) { console.error(e); } }
    };

    Scene_NumberInput.prototype.onCancel = function() {
        T._numRequest = null;
        this.popScene();
    };

    Scene_NumberInput.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        if (Input.isTriggered('anyuanTrainer')) { this.onCancel(); return; }
        if (this._helpWindow) this._helpWindow.setText('←→ ±1   ↑↓ ±10   Q/W ±100   滚轮 ±1    Z/回车 确认   X/Esc 取消');
    };

    //=========================================================================
    // 入口: 热键 + 右上角按钮
    //=========================================================================
    Input.keyMapper[OPEN_KEY] = 'anyuanTrainer';

    function openTrainer() {
        if (SceneManager._scene instanceof Scene_Cheat) return;
        if (SceneManager.isSceneChanging && SceneManager.isSceneChanging()) return;
        const s = SceneManager._scene;
        const ok = s instanceof Scene_Map ||
            (typeof Scene_Menu !== 'undefined' && s instanceof Scene_Menu);
        if (!ok) return;
        SceneManager.push(Scene_Cheat);
    }

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        if (Input.isTriggered('anyuanTrainer')) openTrainer();
    };

    // 主菜单里也能用热键打开
    if (typeof Scene_Menu !== 'undefined') {
        const _Scene_Menu_update = Scene_Menu.prototype.update;
        Scene_Menu.prototype.update = function() {
            _Scene_Menu_update.call(this);
            if (Input.isTriggered('anyuanTrainer')) openTrainer();
        };
    }

    //=========================================================================
    // 入口: 热键 + 右上角按钮（已按要求去掉主菜单入口）
    //=========================================================================

    // 右上角按钮（NW.js DOM 覆盖层）
    function createButton() {
        if (!SHOW_BUTTON || typeof document === 'undefined' || !document.body) return;
        if (document.getElementById('anyuan-trainer-btn')) return;
        const btn = document.createElement('div');
        btn.id = 'anyuan-trainer-btn';
        btn.textContent = '修改器';
        btn.style.cssText = [
            'position:fixed', 'top:4px', 'right:4px', 'z-index:2147483000',
            'padding:4px 10px', 'font:12px/1.4 "Microsoft YaHei",sans-serif',
            'color:#fff', 'background:rgba(30,90,160,0.75)',
            'border:1px solid rgba(255,255,255,0.5)', 'border-radius:4px',
            'cursor:pointer', 'user-select:none', 'opacity:0.75'
        ].join(';');
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.75'; });
        const stop = e => { e.stopPropagation(); e.preventDefault(); };
        ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'pointerdown', 'pointerup']
            .forEach(ev => btn.addEventListener(ev, stop, false));
        btn.addEventListener('click', () => { setTimeout(openTrainer, 0); }, false);
        document.body.appendChild(btn);
    }
    if (typeof document !== 'undefined') {
        if (document.body) createButton();
        else document.addEventListener('DOMContentLoaded', createButton);
    }

    // 调试: 暴露到全局，方便控制台调用
    window.AnYuanTrainer.run = sym => (RUN[sym] ? RUN[sym]() : '未知功能: ' + sym);
    window.AnYuanTrainer.open = openTrainer;
    window.AnYuanTrainer._internals = {
        PICK, CMDS, RUN, infoText, LIST,
        Scene_Cheat, Scene_PickNumber, Scene_NumberInput,
        Window_PickList, Window_ValueInput, Window_CheatCommand,
    };
    console.log('[AnYuan_Trainer] v1.3 已加载：F10 或右上角按钮 打开');
})();
