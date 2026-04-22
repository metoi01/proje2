package edu.bilkent.aresx

data class QuestionOption(val value: String, val label: String)

data class SurveyQuestion(
    val id: String,
    val type: String,
    val title: String,
    val required: Boolean,
    val stable: Boolean,
    val options: List<QuestionOption> = emptyList(),
    val min: Int = 1,
    val max: Int = 5
)

data class Predicate(val kind: String, val questionId: String?, val value: String?)

data class ConditionalEdge(val id: String, val from: String, val to: String, val predicate: Predicate)

data class SurveySchema(
    val id: String,
    val title: String,
    val description: String,
    val version: Int,
    val schemaHash: String,
    val questions: List<SurveyQuestion>,
    val edges: List<ConditionalEdge>
)

data class VisibilityResult(
    val visibleQuestionIds: List<String>,
    val sendEnabled: Boolean,
    val blockers: List<String>,
    val stableNodeId: String?,
    val orphanQuestionIds: List<String>,
    val hiddenClearedAnswerIds: List<String>
)

object RclrEngine {
    fun isAnswered(value: Any?): Boolean = when (value) {
        null -> false
        is String -> value.trim().isNotEmpty()
        is Number -> true
        is List<*> -> value.isNotEmpty()
        else -> false
    }

    fun validateDag(schema: SurveySchema): Boolean {
        val ids = schema.questions.map { it.id }.toSet()
        if (ids.size != schema.questions.size || ids.isEmpty()) return false
        if (schema.edges.any { it.from !in ids || it.to !in ids || (it.predicate.questionId ?: it.from) !in ids }) return false

        val indegree = ids.associateWith { id -> schema.edges.count { it.to == id } }.toMutableMap()
        val queue = ArrayDeque(indegree.filterValues { it == 0 }.keys)
        var visited = 0
        while (queue.isNotEmpty()) {
            val id = queue.removeFirst()
            visited += 1
            schema.edges.filter { it.from == id }.forEach { edge ->
                val degree = (indegree[edge.to] ?: 0) - 1
                indegree[edge.to] = degree
                if (degree == 0) queue.add(edge.to)
            }
        }
        return visited == ids.size
    }

    fun resolveVisibility(schema: SurveySchema, answers: Map<String, Any?>): VisibilityResult {
        val questionById = schema.questions.associateBy { it.id }
        val incoming = schema.edges.groupBy { it.to }
        val outgoing = schema.edges.groupBy { it.from }
        val roots = schema.questions.filter { question -> schema.edges.none { it.to == question.id } }.map { it.id }
            .ifEmpty { schema.questions.take(1).map { it.id } }

        val visible = linkedSetOf<String>()
        fun visit(id: String) {
            if (!questionById.containsKey(id) || !visible.add(id)) return
            outgoing[id].orEmpty().filter { predicateSatisfied(it.predicate, it, answers) }.forEach { visit(it.to) }
        }
        roots.forEach { visit(it) }

        val orphan = visible.filter { id ->
            id !in roots && incoming[id].orEmpty().none { edge -> edge.from in visible && predicateSatisfied(edge.predicate, edge, answers) }
        }
        val ordered = topologicalOrder(schema).filter { it in visible }
        val blockers = ordered.mapNotNull { id ->
            val q = questionById[id]
            if (q?.required == true && !isAnswered(answers[id])) id else null
        }
        val hidden = answers.keys.filter { it !in visible }
        val answeredStable = ordered.mapNotNull { questionById[it] }.filter { it.stable && isAnswered(answers[it.id]) }
        val fallbackStable = ordered.mapNotNull { questionById[it] }.firstOrNull { it.stable }
        return VisibilityResult(
            visibleQuestionIds = ordered,
            sendEnabled = blockers.isEmpty() && orphan.isEmpty() && validateDag(schema),
            blockers = blockers,
            stableNodeId = answeredStable.lastOrNull()?.id ?: fallbackStable?.id,
            orphanQuestionIds = orphan,
            hiddenClearedAnswerIds = hidden
        )
    }

    private fun predicateSatisfied(predicate: Predicate, edge: ConditionalEdge, answers: Map<String, Any?>): Boolean {
        val id = predicate.questionId ?: edge.from
        val answer = answers[id]
        return when (predicate.kind) {
            "equals" -> answer?.toString() == predicate.value
            "includes" -> answer is List<*> && answer.map { it.toString() }.contains(predicate.value)
            "rating-at-least" -> answer is Number && answer.toInt() >= (predicate.value?.toIntOrNull() ?: 0)
            "answered" -> isAnswered(answer)
            "not-answered" -> !isAnswered(answer)
            else -> false
        }
    }

    private fun topologicalOrder(schema: SurveySchema): List<String> {
        val ids = schema.questions.map { it.id }
        val indegree = ids.associateWith { id -> schema.edges.count { it.to == id } }.toMutableMap()
        val queue = ArrayDeque(indegree.filterValues { it == 0 }.keys)
        val ordered = mutableListOf<String>()
        while (queue.isNotEmpty()) {
            val id = queue.removeFirst()
            ordered.add(id)
            schema.edges.filter { it.from == id }.forEach { edge ->
                val degree = (indegree[edge.to] ?: 0) - 1
                indegree[edge.to] = degree
                if (degree == 0) queue.add(edge.to)
            }
        }
        return if (ordered.size == schema.questions.size) ordered else ids
    }
}
