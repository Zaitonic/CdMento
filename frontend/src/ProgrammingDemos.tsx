import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Layers,
  RotateCcw,
} from "lucide-react";

const cards = [
  {
    topic: "Variables",
    question: "What is a variable?",
    answer: "A named place to store a value you can use in your program.",
    code: "let score = 10;",
    detail: "Here, score holds the number 10.",
  },
  {
    topic: "Data types",
    question: "What is a string?",
    answer: "A value that represents text, written inside quotes.",
    code: 'const name = "Ada";',
    detail: '"Ada" is a string. 42 is a number.',
  },
  {
    topic: "Conditions",
    question: "What does an if statement do?",
    answer: "It runs a block of code only when a condition is true.",
    code: 'if (score >= 10) {\n  console.log("You passed!");\n}',
    detail: "The message appears when score is at least 10.",
  },
  {
    topic: "Loops",
    question: "Why do we use a loop?",
    answer:
      "To repeat a task without writing the same instructions over and over.",
    code: "for (let i = 0; i < 3; i++) {\n  console.log(i);\n}",
    detail: "This prints 0, then 1, then 2.",
  },
  {
    topic: "Functions",
    question: "What is a function?",
    answer:
      "A reusable block of code that performs a task and can return a result.",
    code: "function add(a, b) {\n  return a + b;\n}",
    detail: "Calling add(2, 3) returns 5.",
  },
];
const questions = [
  {
    topic: "Variables",
    question: "Which line creates a variable that can be reassigned?",
    code: null,
    options: ["let score = 10;", "const score = 10;", 'console.log("score");'],
    correct: 0,
    explanation:
      "let declares a variable you can reassign. const creates a binding you cannot reassign; console.log prints a value.",
  },
  {
    topic: "Data types",
    question: "Which value is a string?",
    code: null,
    options: ["42", '"Hello"', "true"],
    correct: 1,
    explanation:
      '"Hello" is text inside quotes. 42 is a number, and true is a boolean.',
  },
  {
    topic: "Operators",
    question: "What does this code print?",
    code: "console.log(2 + 3);",
    options: ["23", "5", '"2 + 3"'],
    correct: 1,
    explanation: "Both operands are numbers, so + adds them. The result is 5.",
  },
  {
    topic: "Loops",
    question: "How many times does this loop print Hi?",
    code: 'for (let i = 0; i < 3; i++) {\n  console.log("Hi");\n}',
    options: ["2 times", "3 times", "4 times"],
    correct: 1,
    explanation:
      "The loop runs for i = 0, 1, and 2. It stops when i becomes 3.",
  },
  {
    topic: "Functions",
    question: "What does double(4) return?",
    code: "function double(n) {\n  return n * 2;\n}",
    options: ["2", "6", "8"],
    correct: 2,
    explanation:
      "The function multiplies its input by 2. With n = 4, it returns 8.",
  },
];

export function FlashcardDemo() {
  const [index, setIndex] = useState(0);
  const [flipped, flip] = useState(false);
  const card = cards[index];
  function move(step: number) {
    setIndex((i) => Math.max(0, Math.min(cards.length - 1, i + step)));
    flip(false);
  }
  return (
    <div className="programming-flashcards">
      <div className="demo-meta">
        <span>
          <Layers size={14} /> {card.topic}
        </span>
        <span aria-live="polite">
          Card {index + 1} of {cards.length}
        </span>
      </div>
      <button
        className={`programming-card ${flipped ? "turned" : ""}`}
        onClick={() => flip(!flipped)}
        aria-label={
          flipped ? "Show flashcard question" : "Reveal flashcard answer"
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <span className="programming-card-inner">
          <span className="programming-card-face" aria-hidden={flipped}>
            <span className="demo-card-label">THINK IT THROUGH</span>
            <strong>{card.question}</strong>
            <span className="demo-card-hint">
              Tap to flip and find out <RotateCcw size={14} />
            </span>
          </span>
          <span
            className="programming-card-face programming-card-back"
            aria-hidden={!flipped}
          >
            <span className="demo-card-label">THE LIGHTBULB MOMENT</span>
            <strong>{card.answer}</strong>
            <code>{card.code}</code>
            <span className="demo-card-hint">{card.detail}</span>
          </span>
        </span>
      </button>
      <div className="demo-navigation">
        <button
          aria-label="Previous flashcard"
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ArrowLeft size={15} /> Previous
        </button>
        <span className="demo-card-dots" aria-hidden="true">
          {cards.map((_, i) => (
            <i key={i} className={i === index ? "active" : ""} />
          ))}
        </span>
        <button
          aria-label="Next flashcard"
          disabled={index === cards.length - 1}
          onClick={() => move(1)}
        >
          Next <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

export function QuizDemo() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [done, finish] = useState(false);
  const question = questions[index];
  const chosen = answers[index];
  const answered = chosen !== undefined;
  const score = answers.reduce(
    (total, answer, i) => total + Number(answer === questions[i].correct),
    0,
  );
  function restart() {
    setIndex(0);
    setAnswers([]);
    finish(false);
  }
  if (done)
    return (
      <div className="demo-quiz-result" role="status">
        <span className="demo-result-icon">
          <CheckCircle2 size={29} />
        </span>
        <span className="eyebrow">ONE LITTLE LESSON. A BIG FIRST STEP.</span>
        <h4>
          You scored {score} out of {questions.length}!
        </h4>
        <p>
          {score === questions.length
            ? "You’ve got the basics. Keep that curiosity going!"
            : "Every answer is a chance to learn. Review the explanations and give it another go."}
        </p>
        <button className="pub-button" onClick={restart}>
          <RotateCcw size={15} /> Try the quiz again
        </button>
        <span className="demo-local-note">
          Sample quiz only · your account isn’t changed.
        </span>
      </div>
    );
  return (
    <div className="programming-quiz">
      <div className="demo-meta">
        <span>{question.topic}</span>
        <span aria-live="polite">
          Question {index + 1} of {questions.length}
        </span>
      </div>
      <div
        className="demo-progress"
        role="progressbar"
        aria-label="Quiz progress"
        aria-valuenow={answers.length}
        aria-valuemin={0}
        aria-valuemax={questions.length}
      >
        <span
          style={{ width: `${(answers.length / questions.length) * 100}%` }}
        />
      </div>
      <h4>{question.question}</h4>
      {question.code && (
        <pre className="demo-code">
          <code>{question.code}</code>
        </pre>
      )}
      <div
        className="programming-options"
        role="group"
        aria-label="Choose your answer"
      >
        {question.options.map((option, i) => (
          <button
            key={option}
            disabled={answered}
            aria-label={`${String.fromCharCode(65 + i)}: ${option}`}
            aria-pressed={chosen === i}
            onClick={() => setAnswers([...answers, i])}
            className={
              answered && i === question.correct
                ? "correct"
                : chosen === i
                  ? "incorrect"
                  : ""
            }
          >
            <span className="option-letter">
              {answered && i === question.correct ? (
                <Check size={14} />
              ) : (
                String.fromCharCode(65 + i)
              )}
            </span>
            <code>{option}</code>
          </button>
        ))}
      </div>
      {answered ? (
        <div
          className={`demo-feedback ${chosen === question.correct ? "right" : "wrong"}`}
          role="status"
        >
          <strong>
            {chosen === question.correct
              ? "That’s it!"
              : `Not quite. The answer is ${question.options[question.correct]}`}
          </strong>
          <p>{question.explanation}</p>
        </div>
      ) : (
        <p className="demo-choose-hint">
          Pick an answer. We’ll explain the why.
        </p>
      )}
      <div className="demo-quiz-actions">
        <span>{score} correct so far</span>
        <button
          disabled={!answered}
          onClick={() =>
            index === questions.length - 1 ? finish(true) : setIndex(index + 1)
          }
        >
          {index === questions.length - 1 ? "See my score" : "Next question"}
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
