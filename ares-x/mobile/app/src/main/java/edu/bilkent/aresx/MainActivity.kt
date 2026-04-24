package edu.bilkent.aresx

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private data class SubmissionReceipt(
        val surveyId: String,
        val surveyTitle: String,
        val sessionId: String,
        val branchLabel: String?,
        val answeredCount: Int,
        val visibleStepCount: Int,
        val submittedAt: String,
        val path: List<String>
    )

    private val baseUrl = "http://10.0.2.2:3001"
    private var userId = "u-alice"
    private var schema: SurveySchema? = null
    private var sessionId: String? = null
    private val answers = linkedMapOf<String, Any?>()
    private var conflictMessage: String? = null
    private var sendButtonRef: Button? = null
    private var visiblePathRef: TextView? = null
    private var renderedVisibleQuestionIds: List<String> = emptyList()
    private var pendingScrollToEnd = false

    private val bgColor = Color.parseColor("#070B14")
    private val surfaceColor = Color.parseColor("#0F1726")
    private val surfaceRaisedColor = Color.parseColor("#151F32")
    private val strokeColor = Color.parseColor("#20334B")
    private val accentColor = Color.parseColor("#22D3EE")
    private val accentSoftColor = Color.parseColor("#0F2E3B")
    private val textPrimaryColor = Color.parseColor("#E8EEF9")
    private val textSecondaryColor = Color.parseColor("#93A4BB")
    private val warningColor = Color.parseColor("#FFB703")
    private val dangerColor = Color.parseColor("#FF6B81")
    private val successColor = Color.parseColor("#43D17A")
    private val successSoftColor = Color.parseColor("#11261A")
    private val subduedButtonTextColor = Color.parseColor("#6F859C")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.setBackgroundColor(bgColor)
        showLogin()
    }

    private fun showLogin() {
        clearSurveyBindings()
        val (root, content) = screen()

        val hero = sectionCard(emphasis = true)
        hero.addView(title("ARES.X", 34))
        hero.addView(text("Secure adaptive survey orchestration adapted from Project 1.", 15, textSecondaryColor))
        content.addView(hero)

        val form = sectionCard()
        val email = edit("alice@ares.test", "login-email")
        val password = edit("Test1234!", "login-password")
        password.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        val status = text("", 14, warningColor).also { it.contentDescription = "login-error" }
        val button = primaryButton("Sign in", "login-submit")
        button.setOnClickListener {
            status.text = "Signing in..."
            postJson("/api/auth/login", JSONObject().put("email", email.text.toString()).put("password", password.text.toString())) { result, error ->
                if (error != null) {
                    status.text = error
                } else {
                    userId = result!!.getJSONObject("user").getString("id")
                    showSurveyList()
                }
            }
        }

        form.addView(label("Email"))
        form.addView(email)
        form.addView(space(12))
        form.addView(label("Password"))
        form.addView(password)
        form.addView(space(16))
        form.addView(text("Risk-aware login: local seeded account, secure session, deterministic automation.", 13, warningColor))
        form.addView(space(16))
        form.addView(button)
        form.addView(space(12))
        form.addView(status)
        content.addView(form)

        replaceContent(root)
    }

    private fun showSurveyList() {
        clearSurveyBindings()
        val (root, content) = screen()

        val hero = sectionCard(emphasis = true)
        hero.addView(title("Available Surveys", 28))
        hero.addView(text("Pick a survey to continue from the seeded mobile account.", 14, textSecondaryColor))
        content.addView(hero)

        val listCard = sectionCard()
        listCard.addView(text("Loading surveys...", 14, textSecondaryColor))
        content.addView(listCard)

        getJson("/api/surveys") { result, error ->
            runOnUiThread {
                listCard.removeAllViews()
                if (error != null) {
                    listCard.addView(text(error, 14, dangerColor))
                    return@runOnUiThread
                }
                val surveys = result!!.getJSONArray("surveys")
                for (i in 0 until surveys.length()) {
                    val item = surveys.getJSONObject(i)
                    val b = secondaryButton("${item.getString("title")}  v${item.getInt("version")}", "survey-card-${item.getString("id")}")
                    b.setOnClickListener { startSession(item.getString("id")) }
                    listCard.addView(b)
                    if (i < surveys.length() - 1) {
                        listCard.addView(space(12))
                    }
                }
            }
        }

        replaceContent(root)
    }

    private fun startSession(surveyId: String) {
        postJson("/api/sessions", JSONObject().put("surveyId", surveyId).put("userId", userId)) { result, error ->
            if (error != null) {
                showConflict("SESSION_ERROR: $error")
                return@postJson
            }
            schema = parseSchema(result!!.getJSONObject("schema"))
            sessionId = result.getJSONObject("session").getString("id")
            answers.clear()
            conflictMessage = null
            showSurvey()
        }
    }

    private fun showSurvey() {
        val current = schema ?: return
        val visibility = RclrEngine.resolveVisibility(current, answers)
        val (root, content) = screen()
        renderedVisibleQuestionIds = visibility.visibleQuestionIds

        val header = sectionCard(emphasis = true)
        header.addView(text("Adaptive Flow", 12, accentColor, Typeface.BOLD))
        header.addView(title(current.title, 24))
        if (current.description.isNotBlank()) {
            header.addView(text(current.description, 14, textSecondaryColor))
        }
        header.addView(metaChip("Schema v${current.version} / ${current.schemaHash}").also { it.contentDescription = "schema-version" })
        content.addView(header)

        if (conflictMessage != null) {
            val banner = sectionCard()
            banner.background = roundedDrawable(Color.parseColor("#2A1D10"), warningColor, 24)
            banner.addView(text(conflictMessage!!, 14, warningColor, Typeface.BOLD).also { it.contentDescription = "conflict-banner" })
            content.addView(banner)
        }

        current.questions
            .filter { it.id in visibility.visibleQuestionIds }
            .forEachIndexed { index, question -> renderQuestion(content, question, index + 1) }

        val footer = sectionCard(emphasis = true)
        val send = primaryButton("Send responses", "send-button")
        sendButtonRef = send
        send.setOnClickListener {
            val latestVisibility = resolveCurrentVisibility() ?: return@setOnClickListener
            applySendState(latestVisibility)
            if (latestVisibility.visibleQuestionIds != renderedVisibleQuestionIds) {
                showSurvey()
                return@setOnClickListener
            }
            if (!latestVisibility.sendEnabled) return@setOnClickListener
            send.isEnabled = false
            send.text = "Sending..."
            submitSurvey(current, latestVisibility)
        }
        footer.addView(send)
        footer.addView(space(12))
        val pathView = text("Visible path: ${visibility.visibleQuestionIds.joinToString(" -> ")}", 12, textSecondaryColor).also {
            it.contentDescription = "visible-path"
        }
        visiblePathRef = pathView
        footer.addView(pathView)
        content.addView(footer)
        applySendState(visibility)

        replaceContent(root)
        if (pendingScrollToEnd) {
            pendingScrollToEnd = false
            root.post { root.fullScroll(View.FOCUS_DOWN) }
        }
    }

    private fun showSubmissionSuccess(receipt: SubmissionReceipt) {
        clearSurveyBindings()
        val (root, content) = screen()
        content.contentDescription = "submission-screen"

        val hero = sectionCard(emphasis = true)
        hero.background = roundedDrawable(successSoftColor, successColor, 28)
        hero.addView(text("Submission complete", 12, successColor, Typeface.BOLD))
        hero.addView(text("Responses sent", 32, textPrimaryColor, Typeface.BOLD).also { it.contentDescription = "submission-title" })
        hero.addView(text("The adaptive response has been stored and marked as submitted for this session.", 15, textSecondaryColor).also { it.contentDescription = "submission-message" })
        content.addView(hero)

        val summary = sectionCard()
        val statRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = matchWidth()
        }
        statRow.addView(pill("Submitted", successColor, successSoftColor, successColor))
        statRow.addView(pill("${receipt.answeredCount} answers", accentColor, accentSoftColor, accentColor).apply { setMarginStart(dp(8)) })
        statRow.addView(pill("${receipt.visibleStepCount} steps", accentColor, accentSoftColor, accentColor).apply { setMarginStart(dp(8)) })
        summary.addView(statRow)
        summary.addView(space(6))
        summary.addView(text(receipt.surveyTitle, 22, textPrimaryColor, Typeface.BOLD))
        summary.addView(summaryRow("Primary branch", receipt.branchLabel ?: "Adaptive path"))
        summary.addView(summaryRow("Session", shortenSessionId(receipt.sessionId)).also { it.contentDescription = "submission-session" })
        summary.addView(summaryRow("Submitted at", formatTimestamp(receipt.submittedAt)))
        summary.addView(space(6))
        summary.addView(text("Visible path", 12, textSecondaryColor, Typeface.BOLD))
        summary.addView(text(receipt.path.joinToString(" -> "), 13, textSecondaryColor).also { it.contentDescription = "submission-path" })
        content.addView(summary)

        val actions = sectionCard()
        actions.addView(text("Next actions", 18, textPrimaryColor, Typeface.BOLD))
        actions.addView(text("You can immediately start a fresh response for the same survey or go back to the survey list.", 14, textSecondaryColor))
        actions.addView(space(12))

        val startAnother = primaryButton("Start another response", "submission-start-another")
        startAnother.setOnClickListener { startSession(receipt.surveyId) }
        val backToSurveys = secondaryButton("Back to surveys", "submission-back-to-surveys")
        backToSurveys.setOnClickListener {
            resetSessionState()
            showSurveyList()
        }
        actions.addView(startAnother)
        actions.addView(space(12))
        actions.addView(backToSurveys)
        content.addView(actions)

        replaceContent(root)
    }

    private fun renderQuestion(parent: LinearLayout, question: SurveyQuestion, index: Int) {
        val card = sectionCard()

        val metaRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = matchWidth()
        }
        metaRow.addView(metaChip("Step $index"))
        metaRow.addView(metaChip(questionTypeLabel(question.type)).apply { setMarginStart(dp(8)) })
        if (question.required) {
            metaRow.addView(metaChip("Required").apply { setMarginStart(dp(8)) })
        }
        card.addView(metaRow)
        card.addView(text(question.title, 18, textPrimaryColor, Typeface.BOLD).also { it.contentDescription = "question-${question.id}" })

        when (question.type) {
            "single" -> {
                val group = RadioGroup(this).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = matchWidth()
                }
                question.options.forEach { option ->
                    val rb = RadioButton(this).apply {
                        text = option.label
                        textSize = 16f
                        setTextColor(textPrimaryColor)
                        buttonTintList = ColorStateList.valueOf(accentColor)
                        contentDescription = "answer-${question.id}-${option.value}"
                        isChecked = answers[question.id] == option.value
                        setPadding(0, dp(6), 0, dp(6))
                        setOnClickListener { setAnswer(question.id, option.value) }
                    }
                    group.addView(rb)
                }
                card.addView(group)
            }
            "multiple" -> {
                val selected = (answers[question.id] as? List<*>)?.map { it.toString() }?.toMutableSet() ?: mutableSetOf()
                question.options.forEach { option ->
                    val cb = CheckBox(this).apply {
                        text = option.label
                        textSize = 16f
                        setTextColor(textPrimaryColor)
                        buttonTintList = ColorStateList.valueOf(accentColor)
                        contentDescription = "answer-${question.id}-${option.value}"
                        isChecked = selected.contains(option.value)
                        setPadding(0, dp(6), 0, dp(6))
                        setOnCheckedChangeListener { _, checked ->
                            if (checked) selected.add(option.value) else selected.remove(option.value)
                            setMultiAnswer(question.id, selected.toList())
                        }
                    }
                    card.addView(cb)
                }
            }
            "rating" -> {
                card.addView(text("Tap a score that best reflects the native mobile flow.", 13, textSecondaryColor))
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = matchWidth()
                    gravity = Gravity.CENTER
                }
                val selectedScore = (answers[question.id] as? Number)?.toInt()
                for (score in question.min..question.max) {
                    val b = scoreButton(score.toString(), "answer-${question.id}-$score", selectedScore == score)
                    b.setOnClickListener { setAnswer(question.id, score) }
                    b.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                        if (score > question.min) {
                            marginStart = dp(8)
                        }
                    }
                    row.addView(b)
                }
                card.addView(space(8))
                card.addView(row)
            }
            else -> {
                val input = edit(
                    answers[question.id]?.toString() ?: "",
                    "answer-${question.id}-text",
                    hint = "Share a few notes...",
                    multiline = true
                )
                input.addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit

                    override fun afterTextChanged(s: Editable?) {
                        previewTextAnswer(question.id, s?.toString() ?: "")
                    }
                })
                input.setOnFocusChangeListener { _, hasFocus ->
                    if (!hasFocus) commitTextAnswer(question.id, input.text.toString())
                }
                card.addView(input)
            }
        }

        parent.addView(card)
    }

    private fun setAnswer(id: String, value: Any?) {
        answers[id] = value
        resolveCurrentVisibility() ?: return
        syncAnswers()
        showSurvey()
    }

    /** Multi-select (checkbox) changes: don't rebuild the UI unless the visible path changes. */
    private fun setMultiAnswer(id: String, value: List<String>) {
        answers[id] = value
        val visibility = resolveCurrentVisibility() ?: return
        if (visibility.visibleQuestionIds != renderedVisibleQuestionIds) {
            syncAnswers()
            showSurvey()
            return
        }
        applySendState(visibility)
        syncAnswers()
    }

    private fun previewTextAnswer(id: String, value: String) {
        val visibility = updateDraftTextAnswer(id, value) ?: return
        if (visibility.visibleQuestionIds != renderedVisibleQuestionIds) {
            pendingScrollToEnd = visibility.visibleQuestionIds.size > renderedVisibleQuestionIds.size
            showSurvey()
            return
        }
        applySendState(visibility)
    }

    private fun commitTextAnswer(id: String, value: String) {
        val visibility = updateDraftTextAnswer(id, value) ?: return
        syncAnswers()
        if (visibility.visibleQuestionIds != renderedVisibleQuestionIds) {
            pendingScrollToEnd = visibility.visibleQuestionIds.size > renderedVisibleQuestionIds.size
            showSurvey()
            return
        }
        applySendState(visibility)
    }

    private fun updateDraftTextAnswer(id: String, value: String): VisibilityResult? {
        answers[id] = value
        return resolveCurrentVisibility()
    }

    private fun submitSurvey(current: SurveySchema, visibility: VisibilityResult) {
        val sid = sessionId ?: return
        val body = JSONObject()
            .put("clientSchemaVersion", current.version)
            .put("answers", serializeAnswers())

        postJson("/api/sessions/$sid/submit", body) { result, error ->
            if (error != null || result == null) {
                conflictMessage = "SUBMIT_ERROR: ${extractErrorMessage(error)}"
                showSurvey()
                return@postJson
            }

            conflictMessage = null
            val submittedSession = result.getJSONObject("session")
            val receipt = SubmissionReceipt(
                surveyId = current.id,
                surveyTitle = current.title,
                sessionId = submittedSession.getString("id"),
                branchLabel = findOptionLabel(current, "q-channel", answers["q-channel"]?.toString()),
                answeredCount = visibility.visibleQuestionIds.count { id -> RclrEngine.isAnswered(answers[id]) },
                visibleStepCount = visibility.visibleQuestionIds.size,
                submittedAt = submittedSession.getString("updatedAt"),
                path = visibility.visibleQuestionIds
            )
            showSubmissionSuccess(receipt)
        }
    }

    private fun syncAnswers() {
        val current = schema ?: return
        val sid = sessionId ?: return
        val body = JSONObject().put("clientSchemaVersion", current.version).put("answers", serializeAnswers())
        postJson("/api/sessions/$sid/answers", body) { result, error ->
            if (error != null || result == null) return@postJson
            val resolution = result.getJSONObject("resolution")
            val action = resolution.getString("action")
            if (action != "ok" && action != "atomic_recovery") {
                conflictMessage = "${resolution.optString("conflictCode", "RCLR_CONFLICT")}: ${resolution.getString("message")}"
                schema = parseSchema(result.getJSONObject("schema"))
                answers.clear()
                val preserved = resolution.getJSONObject("preservedAnswers")
                preserved.keys().forEach { key -> answers[key] = preserved.get(key) }
                showSurvey()
            } else if (action == "atomic_recovery") {
                conflictMessage = "ATOMIC_RECOVERY: ${resolution.getString("message")}"
                schema = parseSchema(result.getJSONObject("schema"))
                showSurvey()
            }
        }
    }

    private fun serializeAnswers(): JSONObject {
        val jsonAnswers = JSONObject()
        answers.forEach { (key, value) ->
            when (value) {
                is List<*> -> jsonAnswers.put(key, JSONArray(value))
                else -> jsonAnswers.put(key, value)
            }
        }
        return jsonAnswers
    }

    private fun showConflict(message: String) {
        conflictMessage = message
        clearSurveyBindings()
        val (root, content) = screen()
        val card = sectionCard()
        card.background = roundedDrawable(Color.parseColor("#2B1319"), dangerColor, 24)
        card.addView(text(message, 16, dangerColor, Typeface.BOLD).also { it.contentDescription = "conflict-banner" })
        content.addView(card)
        replaceContent(root)
    }

    private fun resetSessionState() {
        schema = null
        sessionId = null
        conflictMessage = null
        answers.clear()
        clearSurveyBindings()
    }

    private fun parseSchema(obj: JSONObject): SurveySchema {
        val questions = mutableListOf<SurveyQuestion>()
        val qArray = obj.getJSONArray("questions")
        for (i in 0 until qArray.length()) {
            val q = qArray.getJSONObject(i)
            val options = mutableListOf<QuestionOption>()
            val opts = q.optJSONArray("options") ?: JSONArray()
            for (j in 0 until opts.length()) {
                val opt = opts.getJSONObject(j)
                options.add(QuestionOption(opt.getString("value"), opt.getString("label")))
            }
            questions.add(SurveyQuestion(q.getString("id"), q.getString("type"), q.getString("title"), q.getBoolean("required"), q.getBoolean("stable"), options, q.optInt("min", 1), q.optInt("max", 5)))
        }
        val edges = mutableListOf<ConditionalEdge>()
        val eArray = obj.getJSONArray("edges")
        for (i in 0 until eArray.length()) {
            val e = eArray.getJSONObject(i)
            val p = e.getJSONObject("predicate")
            edges.add(ConditionalEdge(e.getString("id"), e.getString("from"), e.getString("to"), Predicate(p.getString("kind"), p.optString("questionId", e.getString("from")), p.opt("value")?.toString())))
        }
        return SurveySchema(obj.getString("id"), obj.getString("title"), obj.optString("description"), obj.getInt("version"), obj.optString("schemaHash"), questions, edges)
    }

    private fun getJson(path: String, callback: (JSONObject?, String?) -> Unit) {
        Thread {
            try {
                val conn = URL("$baseUrl$path").openConnection() as HttpURLConnection
                callback(JSONObject(conn.inputStream.bufferedReader().readText()), null)
            } catch (ex: Exception) {
                callback(null, ex.message ?: "Network error")
            }
        }.start()
    }

    private fun postJson(path: String, body: JSONObject, callback: (JSONObject?, String?) -> Unit) {
        Thread {
            try {
                val conn = URL("$baseUrl$path").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                if (path.contains("/answers")) conn.requestMethod = "PATCH"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
                val text = stream.bufferedReader().readText()
                runOnUiThread { callback(JSONObject(text), if (conn.responseCode in 200..299) null else text) }
            } catch (ex: Exception) {
                runOnUiThread { callback(null, ex.message ?: "Network error") }
            }
        }.start()
    }

    private fun extractErrorMessage(error: String?): String = try {
        error?.let { JSONObject(it).optString("error", it) } ?: "Network error"
    } catch (_: Exception) {
        error ?: "Network error"
    }

    private fun replaceContent(view: View) {
        currentFocus?.let { focused ->
            (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)
                ?.hideSoftInputFromWindow(focused.windowToken, 0)
            focused.clearFocus()
        }
        setContentView(view)
    }

    private fun resolveCurrentVisibility(): VisibilityResult? {
        val current = schema ?: return null
        val initial = RclrEngine.resolveVisibility(current, answers)
        if (initial.hiddenClearedAnswerIds.isNotEmpty()) {
            initial.hiddenClearedAnswerIds.forEach { answers.remove(it) }
            return RclrEngine.resolveVisibility(current, answers)
        }
        return initial
    }

    private fun applySendState(visibility: VisibilityResult) {
        sendButtonRef?.let { send ->
            send.text = "Send responses"
            send.isEnabled = visibility.sendEnabled
            send.alpha = if (visibility.sendEnabled) 1f else .65f
            send.background = roundedDrawable(
                if (visibility.sendEnabled) accentColor else accentSoftColor,
                accentColor,
                20
            )
            send.setTextColor(if (visibility.sendEnabled) bgColor else subduedButtonTextColor)
        }
        visiblePathRef?.text = "Visible path: ${visibility.visibleQuestionIds.joinToString(" -> ")}"
    }

    private fun clearSurveyBindings() {
        sendButtonRef = null
        visiblePathRef = null
        renderedVisibleQuestionIds = emptyList()
        pendingScrollToEnd = false
    }

    private fun screen(): Pair<ScrollView, LinearLayout> {
        val root = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(bgColor)
        }
        val content = column().apply {
            minimumHeight = resources.displayMetrics.heightPixels
            setPadding(dp(20), dp(20), dp(20), dp(28))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(content)
        return root to content
    }

    private fun column(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(bgColor)
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun sectionCard(emphasis: Boolean = false) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = roundedDrawable(if (emphasis) surfaceRaisedColor else surfaceColor, strokeColor, 24)
        setPadding(dp(18), dp(18), dp(18), dp(18))
        layoutParams = matchWidth(bottomMargin = 16)
    }

    private fun title(value: String, size: Int) = text(value, size, accentColor, Typeface.BOLD)

    private fun text(value: String, size: Int, color: Int, typeface: Int = Typeface.NORMAL) = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        setTextColor(color)
        setTypeface(Typeface.create(Typeface.SANS_SERIF, typeface))
        setLineSpacing(0f, 1.12f)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun label(value: String) = text(value.uppercase(), 12, textSecondaryColor, Typeface.BOLD)

    private fun edit(value: String, desc: String, hint: String = "", multiline: Boolean = false) = EditText(this).apply {
        setText(value)
        setHint(hint)
        contentDescription = desc
        setTextColor(textPrimaryColor)
        setHintTextColor(textSecondaryColor)
        background = roundedDrawable(surfaceRaisedColor, strokeColor, 18)
        inputType = if (multiline) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE else InputType.TYPE_CLASS_TEXT
        gravity = if (multiline) Gravity.TOP or Gravity.START else Gravity.CENTER_VERTICAL or Gravity.START
        minHeight = dp(if (multiline) 124 else 56)
        setPadding(dp(16), dp(14), dp(16), dp(14))
        layoutParams = matchWidth()
    }

    private fun primaryButton(value: String, desc: String) = baseButton(
        value = value,
        desc = desc,
        backgroundColor = accentColor,
        textColor = bgColor,
        borderColor = accentColor
    )

    private fun secondaryButton(value: String, desc: String) = baseButton(
        value = value,
        desc = desc,
        backgroundColor = surfaceRaisedColor,
        textColor = textPrimaryColor,
        borderColor = strokeColor
    )

    private fun scoreButton(value: String, desc: String, selected: Boolean) = baseButton(
        value = value,
        desc = desc,
        backgroundColor = if (selected) accentColor else accentSoftColor,
        textColor = if (selected) bgColor else textPrimaryColor,
        borderColor = accentColor
    )

    private fun baseButton(value: String, desc: String, backgroundColor: Int, textColor: Int, borderColor: Int) = Button(this).apply {
        text = value
        contentDescription = desc
        textSize = 15f
        isAllCaps = false
        gravity = Gravity.CENTER
        minHeight = dp(54)
        setTextColor(textColor)
        setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD))
        background = roundedDrawable(backgroundColor, borderColor, 20)
        layoutParams = matchWidth()
    }

    private fun pill(value: String, textColor: Int, backgroundColor: Int, borderColor: Int) = TextView(this).apply {
        text = value
        textSize = 11f
        setTextColor(textColor)
        setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD))
        background = roundedDrawable(backgroundColor, borderColor, 999)
        setPadding(dp(10), dp(6), dp(10), dp(6))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun metaChip(value: String) = pill(value, accentColor, accentSoftColor, accentColor)

    private fun summaryRow(label: String, value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = matchWidth(bottomMargin = 10)
        addView(text(label.uppercase(), 11, textSecondaryColor, Typeface.BOLD))
        addView(text(value, 16, textPrimaryColor, Typeface.BOLD))
    }

    private fun roundedDrawable(fillColor: Int, borderColor: Int, radiusDp: Int) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(radiusDp).toFloat()
        setColor(fillColor)
        setStroke(dp(1), borderColor)
    }

    private fun space(heightDp: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(heightDp))
    }

    private fun matchWidth(bottomMargin: Int = 0) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
        this.bottomMargin = dp(bottomMargin)
    }

    private fun View.setMarginStart(value: Int) {
        val params = layoutParams as? ViewGroup.MarginLayoutParams ?: return
        params.marginStart = value
        layoutParams = params
    }

    private fun questionTypeLabel(type: String) = when (type) {
        "single" -> "Single choice"
        "multiple" -> "Multi select"
        "rating" -> "Rating"
        else -> "Comment"
    }

    private fun findOptionLabel(schema: SurveySchema, questionId: String, selectedValue: String?): String? {
        if (selectedValue == null) return null
        return schema.questions
            .find { it.id == questionId }
            ?.options
            ?.find { it.value == selectedValue }
            ?.label
    }

    private fun shortenSessionId(value: String): String =
        if (value.length <= 24) value else "${value.take(12)}...${value.takeLast(8)}"

    private fun formatTimestamp(value: String): String =
        value.replace('T', ' ').substringBefore('.').removeSuffix("Z")

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
