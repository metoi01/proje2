package edu.bilkent.aresx

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private val baseUrl = "http://10.0.2.2:3001"
    private var userId = "u-alice"
    private var schema: SurveySchema? = null
    private var sessionId: String? = null
    private val answers = linkedMapOf<String, Any?>()
    private var conflictMessage: String? = null

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
    private val subduedButtonTextColor = Color.parseColor("#6F859C")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = bgColor
        window.navigationBarColor = bgColor
        window.decorView.setBackgroundColor(bgColor)
        showLogin()
    }

    private fun showLogin() {
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

        setContentView(root)
    }

    private fun showSurveyList() {
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

        setContentView(root)
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
        send.isEnabled = visibility.sendEnabled
        send.alpha = if (visibility.sendEnabled) 1f else .65f
        send.background = roundedDrawable(
            if (visibility.sendEnabled) accentColor else accentSoftColor,
            accentColor,
            20
        )
        send.setTextColor(if (visibility.sendEnabled) bgColor else subduedButtonTextColor)
        send.setOnClickListener { Toast.makeText(this, "Survey submitted", Toast.LENGTH_SHORT).show() }
        footer.addView(send)
        footer.addView(space(12))
        footer.addView(text("Visible path: ${visibility.visibleQuestionIds.joinToString(" -> ")}", 12, textSecondaryColor).also { it.contentDescription = "visible-path" })
        content.addView(footer)

        setContentView(root)
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
                            setAnswer(question.id, selected.toList())
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
                input.setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) setAnswer(question.id, input.text.toString()) }
                card.addView(input)
            }
        }

        parent.addView(card)
    }

    private fun setAnswer(id: String, value: Any?) {
        answers[id] = value
        val current = schema ?: return
        val visibility = RclrEngine.resolveVisibility(current, answers)
        visibility.hiddenClearedAnswerIds.forEach { answers.remove(it) }
        syncAnswers()
        showSurvey()
    }

    private fun syncAnswers() {
        val current = schema ?: return
        val sid = sessionId ?: return
        val jsonAnswers = JSONObject()
        answers.forEach { (key, value) ->
            when (value) {
                is List<*> -> jsonAnswers.put(key, JSONArray(value))
                else -> jsonAnswers.put(key, value)
            }
        }
        val body = JSONObject().put("clientSchemaVersion", current.version).put("answers", jsonAnswers)
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

    private fun showConflict(message: String) {
        conflictMessage = message
        val (root, content) = screen()
        val card = sectionCard()
        card.background = roundedDrawable(Color.parseColor("#2B1319"), dangerColor, 24)
        card.addView(text(message, 16, dangerColor, Typeface.BOLD).also { it.contentDescription = "conflict-banner" })
        content.addView(card)
        setContentView(root)
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

    private fun screen(): Pair<ScrollView, LinearLayout> {
        val root = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(bgColor)
        }
        val content = column().apply {
            minimumHeight = resources.displayMetrics.heightPixels
            setPadding(dp(20), dp(20), dp(20), dp(28))
            layoutParams = ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
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

    private fun metaChip(value: String) = TextView(this).apply {
        text = value
        textSize = 11f
        setTextColor(accentColor)
        setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD))
        background = roundedDrawable(accentSoftColor, accentColor, 999)
        setPadding(dp(10), dp(6), dp(10), dp(6))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
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

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
