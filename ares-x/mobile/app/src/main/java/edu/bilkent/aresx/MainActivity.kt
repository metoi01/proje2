package edu.bilkent.aresx

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.View
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showLogin()
    }

    private fun showLogin() {
        val root = column()
        root.setPadding(36, 64, 36, 36)
        root.addView(title("ARES.X", 36))
        root.addView(text("Secure adaptive survey orchestration adapted from Project 1.", 15, "#8F98AD"))
        val email = edit("alice@ares.test", "login-email")
        val password = edit("Test1234!", "login-password")
        password.inputType = 0x00000081
        val status = text("", 14, "#FFB703").also { it.contentDescription = "login-error" }
        val button = button("Sign In", "login-submit")
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
        root.addView(label("Email"))
        root.addView(email)
        root.addView(label("Password"))
        root.addView(password)
        root.addView(text("Risk-aware login: local seeded account, secure session, deterministic automation.", 13, "#FFB703"))
        root.addView(button)
        root.addView(status)
        setContentView(root)
    }

    private fun showSurveyList() {
        val root = column()
        root.setPadding(28, 48, 28, 28)
        root.addView(title("Available Surveys", 28))
        getJson("/api/surveys") { result, error ->
            if (error != null) {
                root.addView(text(error, 14, "#FF4D6D"))
                return@getJson
            }
            val surveys = result!!.getJSONArray("surveys")
            runOnUiThread {
                for (i in 0 until surveys.length()) {
                    val item = surveys.getJSONObject(i)
                    val b = button("${item.getString("title")}  v${item.getInt("version")}", "survey-card-${item.getString("id")}")
                    b.setOnClickListener { startSession(item.getString("id")) }
                    root.addView(b)
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
        val root = ScrollView(this)
        val content = column()
        content.setPadding(24, 40, 24, 28)
        root.addView(content)
        content.addView(title(current.title, 26))
        content.addView(text("Schema v${current.version} / ${current.schemaHash}", 12, "#8F98AD").also { it.contentDescription = "schema-version" })
        if (conflictMessage != null) {
            content.addView(text(conflictMessage!!, 14, "#FFB703").also { it.contentDescription = "conflict-banner" })
        }
        current.questions.filter { it.id in visibility.visibleQuestionIds }.forEach { question ->
            renderQuestion(content, question)
        }
        val send = button("Send", "send-button")
        send.isEnabled = visibility.sendEnabled
        send.alpha = if (visibility.sendEnabled) 1f else .45f
        send.setOnClickListener { Toast.makeText(this, "Survey submitted", Toast.LENGTH_SHORT).show() }
        content.addView(send)
        content.addView(text("Visible path: ${visibility.visibleQuestionIds.joinToString(" -> ")}", 12, "#8F98AD").also { it.contentDescription = "visible-path" })
        setContentView(root)
    }

    private fun renderQuestion(parent: LinearLayout, question: SurveyQuestion) {
        parent.addView(text(question.title, 17, "#E8EAF6").also { it.contentDescription = "question-${question.id}" })
        when (question.type) {
            "single" -> {
                val group = RadioGroup(this)
                question.options.forEach { option ->
                    val rb = RadioButton(this)
                    rb.text = option.label
                    rb.setTextColor(Color.parseColor("#E8EAF6"))
                    rb.contentDescription = "answer-${question.id}-${option.value}"
                    rb.isChecked = answers[question.id] == option.value
                    rb.setOnClickListener { setAnswer(question.id, option.value) }
                    group.addView(rb)
                }
                parent.addView(group)
            }
            "multiple" -> {
                val selected = (answers[question.id] as? List<*>)?.map { it.toString() }?.toMutableSet() ?: mutableSetOf()
                question.options.forEach { option ->
                    val cb = CheckBox(this)
                    cb.text = option.label
                    cb.setTextColor(Color.parseColor("#E8EAF6"))
                    cb.contentDescription = "answer-${question.id}-${option.value}"
                    cb.isChecked = selected.contains(option.value)
                    cb.setOnCheckedChangeListener { _, checked ->
                        if (checked) selected.add(option.value) else selected.remove(option.value)
                        setAnswer(question.id, selected.toList())
                    }
                    parent.addView(cb)
                }
            }
            "rating" -> {
                val row = LinearLayout(this)
                row.orientation = LinearLayout.HORIZONTAL
                for (score in question.min..question.max) {
                    val b = button(score.toString(), "answer-${question.id}-$score")
                    b.setOnClickListener { setAnswer(question.id, score) }
                    row.addView(b)
                }
                parent.addView(row)
            }
            else -> {
                val input = edit(answers[question.id]?.toString() ?: "", "answer-${question.id}-text")
                input.setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) setAnswer(question.id, input.text.toString()) }
                parent.addView(input)
            }
        }
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
        val root = column()
        root.setPadding(28, 48, 28, 28)
        root.addView(text(message, 16, "#FFB703").also { it.contentDescription = "conflict-banner" })
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

    private fun column(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Color.parseColor("#0A0C12"))
    }

    private fun title(value: String, size: Int) = text(value, size, "#00E5FF")

    private fun text(value: String, size: Int, color: String) = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        setTextColor(Color.parseColor(color))
        setPadding(0, 8, 0, 8)
    }

    private fun label(value: String) = text(value.uppercase(), 12, "#8F98AD")

    private fun edit(value: String, desc: String) = EditText(this).apply {
        setText(value)
        contentDescription = desc
        setTextColor(Color.parseColor("#E8EAF6"))
        setHintTextColor(Color.parseColor("#8F98AD"))
        setBackgroundColor(Color.parseColor("#111320"))
    }

    private fun button(value: String, desc: String) = Button(this).apply {
        text = value
        contentDescription = desc
        setTextColor(Color.parseColor("#061016"))
        setBackgroundColor(Color.parseColor("#00E5FF"))
    }
}
