import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE_URL = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');

// index.html과 동일한 Supabase 프로젝트. REST 호출에는 PostgREST가 요구하는
// legacy JWT anon 키를 사용 (신형 sb_publishable_ 키는 supabase-js를 통해서만 검증됨).
const SUPABASE_URL = 'https://eehlmijjrtorfdxfegeg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlaGxtaWpqcnRvcmZkeGZlZ2VnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNjAzODcsImV4cCI6MjA5ODczNjM4N30.0mzls7nNwXzNo0tdqRjY82pHmvq7FshweBdbYnB2upg';

// DB 반영 후 UI 렌더링까지 대기하는 시간 (Supabase 왕복 시간 고려)
const DB_SYNC_WAIT = 800;

async function clearDatabase() {
  await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?id=gt.0`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
}

let passed = 0;
let failed = 0;

function log(emoji, msg) { console.log(`  ${emoji} ${msg}`); }

async function assert(label, condition) {
  if (condition) {
    log('✅', label);
    passed++;
  } else {
    log('❌', label);
    failed++;
  }
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const page = await browser.newPage();

  try {
    await runScenarios(page);
  } finally {
    await page.waitForTimeout(1500);
    await browser.close();
    // 다음 실행 및 실제 앱 사용에 영향 없도록 테스트 데이터 정리
    await clearDatabase();
  }

  const total = passed + failed;
  console.log('\n' + '─'.repeat(40));
  console.log(`📊 테스트 결과: ${passed}/${total} 통과`);
  if (failed === 0) {
    console.log('🎉 모든 테스트 통과!');
  } else {
    console.log(`⚠️  ${failed}개 실패`);
  }
  console.log('─'.repeat(40) + '\n');
}

async function runScenarios(page) {
  // Supabase 테이블 초기화 후 앱 로드
  await clearDatabase();
  await page.goto(FILE_URL);
  await page.waitForTimeout(DB_SYNC_WAIT);

  // ──────────────────────────────────────────────
  console.log('\n📋 [1] 아이템 추가 테스트');
  // ──────────────────────────────────────────────

  // Enter 키로 추가
  await page.fill('#input', '우유');
  await page.press('#input', 'Enter');
  await page.waitForTimeout(DB_SYNC_WAIT);
  let items = await page.$$('.item');
  await assert('Enter 키로 아이템 추가', items.length === 1);

  // 추가 버튼으로 추가
  await page.fill('#input', '달걀');
  await page.click('.add-btn');
  await page.waitForTimeout(DB_SYNC_WAIT);
  items = await page.$$('.item');
  await assert('추가 버튼으로 아이템 추가', items.length === 2);

  // 세 번째 아이템
  await page.fill('#input', '빵');
  await page.press('#input', 'Enter');
  await page.waitForTimeout(DB_SYNC_WAIT);
  items = await page.$$('.item');
  await assert('3개 아이템 존재', items.length === 3);

  // 빈 입력 무시
  await page.fill('#input', '   ');
  await page.press('#input', 'Enter');
  items = await page.$$('.item');
  await assert('빈 입력은 추가되지 않음', items.length === 3);

  // 입력창 초기화 확인
  const inputVal = await page.inputValue('#input');
  await assert('추가 후 입력창 초기화', inputVal.trim() === '');

  // 아이템 이름 확인
  const firstItemText = await page.textContent('.item:first-child .item-name');
  await assert('가장 최근 아이템이 맨 위에 표시 (빵)', firstItemText.trim() === '빵');

  // ──────────────────────────────────────────────
  console.log('\n☑️  [2] 체크(완료) 기능 테스트');
  // ──────────────────────────────────────────────

  // 첫 번째 아이템(빵) 체크
  await page.click('.item:first-child .check-btn');
  await page.waitForTimeout(DB_SYNC_WAIT);
  const isChecked = await page.$('.item.checked');
  await assert('아이템 체크 시 checked 클래스 추가', isChecked !== null);

  const hasStrike = await page.$eval('.item.checked .item-name', el =>
    getComputedStyle(el).textDecorationLine.includes('line-through')
  );
  await assert('완료 아이템에 취소선 표시', hasStrike);

  // 체크 해제
  await page.click('.item.checked .check-btn');
  await page.waitForTimeout(DB_SYNC_WAIT);
  const stillChecked = await page.$('.item.checked');
  await assert('다시 클릭 시 체크 해제', stillChecked === null);

  // stats 업데이트 확인
  await page.click('.item:first-child .check-btn');
  await page.waitForTimeout(DB_SYNC_WAIT);
  const stats = await page.textContent('#stats');
  await assert('헤더 통계 업데이트 (1/3개 완료)', stats.includes('1/3'));

  // ──────────────────────────────────────────────
  console.log('\n🗑️  [3] 아이템 삭제 테스트');
  // ──────────────────────────────────────────────

  // 미완료 아이템(달걀) 삭제 — 마지막 아이템
  const beforeDelete = await page.$$('.item');
  await page.click('.item:last-child .delete-btn');
  await page.waitForTimeout(DB_SYNC_WAIT);
  const afterDelete = await page.$$('.item');
  await assert('삭제 후 아이템 수 감소 (3→2)', afterDelete.length === beforeDelete.length - 1);

  // 남은 아이템 이름 확인 (unshift로 추가되므로 DOM 순서: 빵→달걀→우유, last-child는 우유)
  const remainingTexts = await page.$$eval('.item .item-name', els =>
    els.map(el => el.textContent.trim())
  );
  await assert('삭제 후 올바른 아이템 남음 (빵, 달걀)',
    remainingTexts.includes('빵') && remainingTexts.includes('달걀') && !remainingTexts.includes('우유'));

  // ──────────────────────────────────────────────
  console.log('\n🔽 [4] 필터 탭 테스트');
  // ──────────────────────────────────────────────

  // 현재 상태: 빵(완료), 우유(미완료)
  // 완료 탭
  await page.click('.tab:nth-child(3)');
  const doneItems = await page.$$('.item');
  await assert('완료 탭: 완료 아이템만 표시 (1개)', doneItems.length === 1);

  const doneText = await page.textContent('.item .item-name');
  await assert('완료 탭: 빵 표시', doneText.trim() === '빵');

  // 미완료 탭
  await page.click('.tab:nth-child(2)');
  const pendingItems = await page.$$('.item');
  await assert('미완료 탭: 미완료 아이템만 표시 (1개)', pendingItems.length === 1);

  const pendingText = await page.textContent('.item .item-name');
  await assert('미완료 탭: 달걀 표시', pendingText.trim() === '달걀');

  // 전체 탭
  await page.click('.tab:nth-child(1)');
  const allItems = await page.$$('.item');
  await assert('전체 탭: 모든 아이템 표시 (2개)', allItems.length === 2);

  // ──────────────────────────────────────────────
  console.log('\n🧹 [5] 완료 항목 일괄 삭제 테스트');
  // ──────────────────────────────────────────────

  await page.click('.clear-btn');
  await page.waitForTimeout(DB_SYNC_WAIT);
  const afterClear = await page.$$('.item');
  await assert('완료 항목 삭제 후 미완료만 남음 (1개)', afterClear.length === 1);

  const survivorText = await page.textContent('.item .item-name');
  await assert('미완료 아이템(달걀)은 유지', survivorText.trim() === '달걀');

  // ──────────────────────────────────────────────
  console.log('\n💾 [6] Supabase 데이터 유지 테스트');
  // ──────────────────────────────────────────────

  await page.fill('#input', '주스');
  await page.press('#input', 'Enter');
  await page.waitForTimeout(DB_SYNC_WAIT);
  await page.reload();
  await page.waitForTimeout(DB_SYNC_WAIT);

  const afterReload = await page.$$('.item');
  await assert('새로고침 후 아이템 유지', afterReload.length === 2);

  const reloadTexts = await page.$$eval('.item .item-name', els =>
    els.map(el => el.textContent.trim())
  );
  await assert('새로고침 후 아이템 내용 동일',
    reloadTexts.includes('달걀') && reloadTexts.includes('주스'));
}

run().catch(err => { console.error(err); process.exit(1); });
