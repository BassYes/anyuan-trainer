#!/usr/bin/env node
'use strict';

/**
 * 黯渊崛起 修改器 — 统一启动器
 *
 *  方案B「内置修改器」为主：注入插件，游戏内实时修改（F10 / 主菜单「修改器」）
 *  方案A「存档修改器」为辅：直接读写 save/*.rmmzsave
 *
 * 用法: node launcher.js [--game "游戏目录"]
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const BUILTIN = path.join(HERE, 'builtin');
const SAVE_EDITOR = path.join(HERE, 'save-editor');
const DEFAULT_GAME_DIR = 'E:\\SteamLibrary\\steamapps\\common\\暗渊崛起 Demo';

function parseArgs(argv) {
    let gameDir = DEFAULT_GAME_DIR;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--game') gameDir = argv[++i];
    }
    return { gameDir };
}

function runNode(script, args, env) {
    const r = spawnSync(process.execPath, [script].concat(args || []), {
        stdio: 'inherit',
        env: Object.assign({}, process.env, env || {}),
    });
    if (r.error) console.error('启动失败: ' + r.error.message);
}

const INSTALL = path.join(BUILTIN, 'install.js');
const TESTER = path.join(BUILTIN, '_test_plugin.js');
const TRAINER_A = path.join(SAVE_EDITOR, 'trainer.js');

function builtinStatus() {
    try {
        const pluginsJs = path.join(gameDir, 'js', 'plugins.js');
        const pluginFile = path.join(gameDir, 'js', 'plugins', 'AnYuan_Trainer.js');
        if (!fs.existsSync(pluginsJs)) return '游戏目录未找到';
        const t = fs.readFileSync(pluginsJs, 'utf8');
        const inList = t.includes('"name":"AnYuan_Trainer"') || t.includes('"name": "AnYuan_Trainer"');
        const fileOk = fs.existsSync(pluginFile);
        if (inList && fileOk) return '已安装 ✓';
        if (inList || fileOk) return '不完整（建议重新安装）';
        return '未安装';
    } catch (e) { return '未知'; }
}

let gameDir = DEFAULT_GAME_DIR;

const MENU = [
    ['1', '安装 / 更新 内置修改器', () => runNode(INSTALL, ['--game', gameDir, 'install'])],
    ['2', '卸载 内置修改器（还原原版）', () => runNode(INSTALL, ['--game', gameDir, 'uninstall'])],
    ['3', '查看安装状态', () => runNode(INSTALL, ['--game', gameDir, 'status'])],
    ['4', '运行自检（RMMZ 模拟环境）', () => runNode(TESTER, [], { GAME_DIR: gameDir })],
    ['5', '打开 存档修改器（方案A）', () => runNode(TRAINER_A, ['--game', gameDir])],
    ['g', '设置游戏目录', null],
    ['0', '退出', null],
];

function header() {
    return [
        '========== 黯渊崛起 修改器 ==========',
        '游戏目录: ' + gameDir,
        '内置修改器: ' + builtinStatus(),
        '-------------------------------------',
    ].join('\n');
}

function main() {
    gameDir = parseArgs(process.argv.slice(2)).gameDir;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    async function loop() {
        console.log('\n' + header());
        console.log(' ── 方案B 内置修改器（推荐，游戏内实时）──');
        console.log('   [1] 安装 / 更新');
        console.log('   [2] 卸载（还原原版）');
        console.log('   [3] 查看安装状态');
        console.log('   [4] 运行自检');
        console.log(' ── 方案A 存档修改器（改存档文件）──');
        console.log('   [5] 打开存档修改器');
        console.log(' ── 其他 ──');
        console.log('   [g] 设置游戏目录');
        console.log('   [0] 退出');
        const ans = (await ask('选择: ')).trim().toLowerCase();

        const item = MENU.find(m => m[0] === ans);
        if (!item) { console.log('无效选择'); return loop(); }
        if (item[0] === '0') { rl.close(); process.exit(0); }
        if (item[0] === 'g') {
            const p = (await ask('输入游戏目录（回车取消）: ')).trim();
            if (p) {
                gameDir = p.replace(/^"|"$/g, '');
                console.log('已设为: ' + gameDir);
            }
            return loop();
        }
        try {
            rl.pause();
            item[2]();
        } catch (e) {
            console.error('出错: ' + e.message);
        } finally {
            rl.resume();
        }
        return loop();
    }

    loop().catch(e => { console.error('错误: ' + e.message); process.exit(1); });
}

main();
