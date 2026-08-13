# CLAUDE.md 審查規則

每次 commit 落地後（由 `.claude/hooks/post-commit-claude-md-review.sh` 觸發），
用這份 checklist 判斷 CLAUDE.md 要不要動。

**預設答案是「不用改」。** CLAUDE.md 每一行都會塞進之後每一個 session 的 context，
寫得越多、被讀進去的訊噪比越差。只有下面五類東西值得付這個代價。

## 該寫進 CLAUDE.md 的（符合任一項才寫）

1. **踩過並且會再踩的坑**
   已經因為某個假設而壞過一次、而且下次還會用同樣假設的事。
   例：PostgREST 對多列回應有 1000 筆上限 → RPC 必須回 jsonb 單值。
   判準：能寫成「不要 X，因為會 Y」的具體句子。

2. **新的硬規則 / 流程約束**
   使用者明確要求、或違反過被糾正過的做法。
   例：Supabase DDL 必須留 SQL 檔案。

3. **新子系統或新的導航入口**
   新增了頁面路由、新的 top-level 目錄、或一個需要先讀文件才能動的模組。
   子系統細節寫進 `docs/`，CLAUDE.md 只留一行指標。

4. **DB schema 的結構性變動**
   新表、改欄位語意、或新增會影響顯示金額的欄位（例如任何要乘 share_ratio 的東西）。
   只更新 CLAUDE.md 的核心表清單，欄位細節照舊用 `list_tables` 查。

5. **技術棧 / 指令變更**
   package manager、build 指令、新的驗證腳本、框架大版本升級。

## 不該寫進 CLAUDE.md 的

- **git history 已經記錄的**：修了什麼 bug、改了哪個檔案、某次重構的過程。
- **讀 code 就知道的**：函式在哪、元件怎麼組合、型別長什麼樣。
- **只對這次任務有意義的**：暫時的 workaround、還在進行的工作（那是 `.claude/WIP.md`）。
- **泛泛的好習慣**：「要寫測試」「注意效能」這種沒有本專案特異性的話。
- **已經在別處寫過的**：通知系統的細節屬於 `docs/notifications.md`，
  CLAUDE.md 只留指標，不要複製一份。

## 判斷流程

1. 看這次 commit 的 diff 與 commit message。
2. 對照上面五類。**一項都不符合 → 回「CLAUDE.md 無需更新」，結束。**
3. 符合的話，先找 CLAUDE.md 現有章節能不能改，**優先改既有句子而不是新增段落**。
4. 寫的時候用「規則 + 為什麼」的句型，不要只寫規則 —— 沒有 why 的規則之後會被
   當成沒必要而繞過。
5. 在回覆裡明確講「我改了 CLAUDE.md 的哪一條、為什麼」，讓使用者可以否決。

## 反例（真的發生過的錯誤寫法）

> ❌「修正了 trades table 的 slippage 欄位渲染問題」
> 這是 git history，不是規則。

> ✅「trades 有兩個渲染路徑（run-details / combined），改欄位時兩邊都要動」
> 這才是下次會救到人的知識。
