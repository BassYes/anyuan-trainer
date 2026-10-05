#!/usr/bin/env node
'use strict';

/**
 * 黯渊崛起 修改器 — 版本发布工具
 *
 * 作用：把一个版本做成 GitHub Release，并附上可下载的附件，
 *       让用户能在 https://github.com/<owner>/<repo>/releases 里选择版本下载。
 *
 * 用法:
 *   node release.js                # 用当前 HEAD 自动发布（版本号从插件文件读取）
 *   node release.js v1.3           # 指定 tag，用 HEAD
 *   node release.js v1.2 384a686   # 指定 tag 与提交
 *   node release.js --list         # 列出所有已发布的 release
 *   node release.js --dry          # 只打印将要做什么，不改动远端
 *
 * 依赖: git（含已配置的代理）、curl（走同一代理）、系统里已缓存的 GitHub 凭据
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const REPO = 'BassYes/anyuan-trainer';
const PLUGIN = 'builtin/AnYuan_Trainer.js';
const HERE = __dirname;

// ---------------- 工具 ----------------
function sh(cmd, args, opts) {
    const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts || {}));
    if (r.error) throw new Error(cmd + ' 执行失败: ' + r.error.message);
    return r;
}
function must(cmd, args, opts) {
    const r = sh(cmd, args, opts);
    if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' 失败:\n' + (r.stderr || r.stdout));
    return r.stdout;
}
function proxy() {
    for (const lvl of ['--global', '--system', '--local']) {
        const r = sh('git', ['config', lvl, '--get', 'http.proxy']);
        if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return '';
}
function token() {
    const r = spawnSync('git', ['credential', 'fill'], {
        input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
    });
    const m = (r.stdout || '').match(/^password=(.*)$/m);
    if (!m) throw new Error('未取到 GitHub 凭据（请先 git push 过一次并登录）');
    return m[1];
}
function api(method, url, body, extraArgs) {
    const args = ['-sS', '-X', method, '-H', 'Authorization: token ' + TOKEN,
        '-H', 'User-Agent: anyuan-release', '-H', 'Accept: application/vnd.github+json'];
    const p = PROXY;
    if (p) args.push('--proxy', p);
    if (body !== undefined && body !== null) {
        args.push('-H', 'Content-Type: application/json; charset=utf-8', '--data-binary', '@-');
    }
    args.push(url);
    if (extraArgs) args.push(...extraArgs);
    const r = spawnSync('curl', args, {
        input: body === undefined || body === null ? undefined : Buffer.from(body, 'utf8'),
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw new Error('curl 执行失败: ' + r.error.message);
    return r.stdout;
}
function jget(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// ---------------- 版本信息 ----------------
function pluginVersion(ref) {
    const txt = must('git', ['show', ref + ':' + PLUGIN]);
    const m = txt.match(/v(\d+\.\d+(?:\.\d+)?)\s*已加载/);
    if (!m) throw new Error('无法从 ' + ref + ':' + PLUGIN + ' 读取版本号');
    return m[1];
}
function changelogSection(ver) {
    const f = path.join(HERE, 'CHANGELOG.md');
    if (!fs.existsSync(f)) return '';
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    const out = [];
    let on = false;
    for (const line of lines) {
        if (/^##\s/.test(line)) {
            const m = line.match(/^##\s*(v?[\d.]+)/);
            if (m && m[1].replace(/^v/, '') === ver) { on = true; out.push(line); continue; }
            if (on) break;
        }
        if (on) out.push(line);
    }
    return out.join('\n').trim();
}

// ---------------- 附件 ----------------
function buildAssets(ref, ver, tmp) {
    fs.mkdirSync(tmp, { recursive: true });
    const pluginOut = path.join(tmp, 'AnYuan_Trainer-v' + ver + '.js');
    fs.writeFileSync(pluginOut, must('git', ['show', ref + ':' + PLUGIN]), 'utf8');

    const zipOut = path.join(tmp, 'anyuan-trainer-v' + ver + '.zip');
    sh('git', ['archive', '--format=zip', '-o', zipOut, '--prefix=anyuan-trainer-v' + ver + '/', ref]);
    if (!fs.existsSync(zipOut)) throw new Error('git archive 未生成 zip');

    return [pluginOut, zipOut];
}

function uploadAsset(releaseId, file) {
    const name = path.basename(file);
    const url = 'https://uploads.github.com/repos/' + REPO + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(name);
    const args = ['-sS', '-X', 'POST',
        '-H', 'Authorization: token ' + TOKEN,
        '-H', 'User-Agent: anyuan-release',
        '-H', 'Content-Type: application/octet-stream',
        '--data-binary', '@' + file];
    if (PROXY) args.push('--proxy', PROXY);
    args.push(url);
    const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const d = jget(r.stdout);
    if (d && d.browser_download_url) {
        console.log('    ✓ 已上传 ' + name + '  (' + Math.round(d.size / 1024) + ' KB)');
        return true;
    }
    console.log('    ✗ 上传失败 ' + name + ': ' + String(r.stdout).slice(0, 200));
    return false;
}

// ---------------- 主流程 ----------------
let TOKEN = '', PROXY = '';

function release(tag, ref, dry) {
    const ver = tag.replace(/^v/, '');
    console.log('\n===== 发布 ' + tag + '  (ref: ' + ref + ') =====');

    const detected = pluginVersion(ref);
    if (detected !== ver) {
        console.log('  ! 警告: 插件内版本号为 v' + detected + '，与 tag ' + tag + ' 不一致');
    }

    // 1) tag
    const hasTag = sh('git', ['rev-parse', '-q', '--verify', 'refs/tags/' + tag]).status === 0;
    if (!hasTag) {
        const subject = '黯渊崛起 修改器 ' + tag;
        must('git', ['tag', '-a', tag, ref, '-m', subject]);
        console.log('  ① 已创建 tag ' + tag);
    } else {
        console.log('  ① tag ' + tag + ' 已存在');
    }

    if (dry) { console.log('  (dry-run，未推送/未创建 release)'); return; }

    // 2) 推 tag
    const push = sh('git', ['push', 'origin', 'refs/tags/' + tag]);
    console.log('  ② ' + (push.status === 0 ? 'tag 已推送' : 'tag 推送失败: ' + push.stderr.trim()));

    // 3) release
    let rel = jget(api('GET', 'https://api.github.com/repos/' + REPO + '/releases/tags/' + tag));
    if (!rel || !rel.id) {
        const body = JSON.stringify({
            tag_name: tag,
            name: '黯渊崛起 修改器 ' + tag,
            body: (changelogSection(ver) || ('版本 ' + tag)) +
                '\n\n---\n**下载说明**：\n' +
                '- `AnYuan_Trainer-v' + ver + '.js` — 只下载插件本体（手动放进 `<游戏>/js/plugins/` 并注册）\n' +
                '- `anyuan-trainer-v' + ver + '.zip` — 完整项目（含安装器、启动器、存档修改器）\n',
            draft: false,
            prerelease: false,
        });
        rel = jget(api('POST', 'https://api.github.com/repos/' + REPO + '/releases', body));
        if (!rel || !rel.id) throw new Error('创建 release 失败');
        console.log('  ③ 已创建 release: ' + rel.html_url);
    } else {
        console.log('  ③ release 已存在: ' + rel.html_url);
    }

    // 4) 附件
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anyuan-rel-'));
    const assets = buildAssets(ref, ver, tmp);
    console.log('  ④ 上传附件:');
    for (const a of assets) uploadAsset(rel.id, a);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    console.log('  ✅ 完成: ' + rel.html_url);
}

function listReleases() {
    const d = jget(api('GET', 'https://api.github.com/repos/' + REPO + '/releases?per_page=50'));
    if (!Array.isArray(d)) { console.log('  获取失败'); return; }
    console.log('已发布 ' + d.length + ' 个版本:');
    for (const r of d) {
        console.log('  ' + r.tag_name.padEnd(8) + (r.prerelease ? '[pre] ' : '      ') + r.html_url);
        for (const a of (r.assets || [])) console.log('      - ' + a.name + '  (' + Math.round(a.size / 1024) + ' KB)');
    }
}

function main() {
    const args = process.argv.slice(2);
    PROXY = proxy();
    TOKEN = token();

    if (args[0] === '--list') { listReleases(); return; }
    const dry = args.includes('--dry');
    const rest = args.filter(a => !a.startsWith('--'));

    let tag = rest[0];
    let ref = rest[1];
    if (!tag) {
        ref = ref || 'HEAD';
        const ver = pluginVersion('HEAD');
        tag = 'v' + ver;
    }
    ref = ref || tag;

    release(tag, ref, dry);
}

main();
