package edu.bilkent.aresx

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RclrEngineTest {
    private fun survey() = SurveySchema(
        id = "customer-feedback",
        title = "ARES-X Adaptive Feedback",
        description = "Fixture",
        version = 1,
        schemaHash = "test",
        questions = listOf(
            SurveyQuestion("q-channel", "single", "Channel?", true, true, listOf(QuestionOption("mobile", "Mobile"), QuestionOption("web", "Web"))),
            SurveyQuestion("q-mobile-rating", "rating", "Mobile rating?", true, true),
            SurveyQuestion("q-final", "text", "Final?", false, true)
        ),
        edges = listOf(
            ConditionalEdge("e1", "q-channel", "q-mobile-rating", Predicate("equals", "q-channel", "mobile")),
            ConditionalEdge("e2", "q-mobile-rating", "q-final", Predicate("answered", "q-mobile-rating", null))
        )
    )

    @Test
    fun matchesBackendVisibilityForBranchingPath() {
        val result = RclrEngine.resolveVisibility(survey(), mapOf("q-channel" to "mobile"))
        assertEquals(listOf("q-channel", "q-mobile-rating"), result.visibleQuestionIds)
        assertFalse(result.sendEnabled)
    }

    @Test
    fun sendButtonUnlocksAfterRequiredVisiblePathIsComplete() {
        val result = RclrEngine.resolveVisibility(survey(), mapOf("q-channel" to "mobile", "q-mobile-rating" to 4))
        assertTrue(result.sendEnabled)
        assertEquals("q-mobile-rating", result.stableNodeId)
    }

    @Test
    fun hiddenAnswersAreReportedForClearing() {
        val result = RclrEngine.resolveVisibility(survey(), mapOf("q-channel" to "web", "q-mobile-rating" to 4))
        assertEquals(listOf("q-channel"), result.visibleQuestionIds)
        assertEquals(listOf("q-mobile-rating"), result.hiddenClearedAnswerIds)
    }
}
