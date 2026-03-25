import type { QuestionnaireAnswer, QuestionnaireQuestion } from "../types";

const isProductRequest = (requestText: string): boolean => {
  const text = requestText.toLowerCase();
  const productKeywords = [
    "laptop",
    "macbook",
    "phone",
    "monitor",
    "printer",
    "keyboard",
    "mouse",
    "software",
    "license",
    "server",
    "ssd",
    "headset"
  ];
  return productKeywords.some((keyword) => text.includes(keyword));
};

const productQuestionnaire = (requestText: string): QuestionnaireQuestion[] => [
  {
    id: "item_match",
    prompt: `For "${requestText}", what kind of quote do you want?`,
    placeholder: "Add model/spec details",
    required: true,
    options: ["Exact item only", "Equivalent alternatives allowed", "Best-value recommendation"],
    allowCustomAnswer: true
  },
  {
    id: "quantity",
    prompt: "How many units do you need?",
    placeholder: "Enter exact quantity",
    required: true,
    options: ["1 unit", "2-5 units", "6-20 units", "20+ units"],
    allowCustomAnswer: true
  },
  {
    id: "delivery",
    prompt: "How soon do you need delivery?",
    placeholder: "Add exact delivery deadline",
    required: true,
    options: ["Within 24 hours", "Within 3 days", "Within 1 week", "Flexible timeline"],
    allowCustomAnswer: true
  },
  {
    id: "budget",
    prompt: "What budget range should vendors target (per unit)?",
    placeholder: "Add exact budget if known",
    required: false,
    options: ["Under $1,000", "$1,000-$2,000", "$2,000-$3,000", "Above $3,000", "Need best available quote"],
    allowCustomAnswer: true
  },
  {
    id: "requirements",
    prompt: "Any must-have requirements?",
    placeholder: "Warranty, configuration, brand, color, region, etc.",
    required: false,
    options: ["Standard warranty is fine", "Extended warranty required", "Specific brand required", "No strict requirements"],
    allowCustomAnswer: true
  }
];

const serviceQuestionnaire = (requestText: string): QuestionnaireQuestion[] => [
  {
    id: "scope",
    prompt: `What scope best matches "${requestText}"?`,
    placeholder: "Add size, area, or project details",
    required: true,
    options: ["Small scope", "Medium scope", "Large scope", "Need help defining scope"],
    allowCustomAnswer: true
  },
  {
    id: "urgency",
    prompt: "How urgent is this work?",
    placeholder: "Add deadline if known",
    required: true,
    options: ["Emergency (24-48 hrs)", "Within 1 week", "Within 1 month", "Flexible"],
    allowCustomAnswer: true
  },
  {
    id: "budget",
    prompt: "What budget range should vendors quote against?",
    placeholder: "Add exact budget if known",
    required: false,
    options: ["Under $1,000", "$1,000-$5,000", "$5,000-$15,000", "Above $15,000", "Need guidance"],
    allowCustomAnswer: true
  },
  {
    id: "requirements",
    prompt: "Any must-have requirements?",
    placeholder: "License, materials, insurance, warranty, access hours",
    required: false,
    options: ["Licensed and insured only", "Warranty required", "Specific materials required", "No strict requirements"],
    allowCustomAnswer: true
  }
];

export const fallbackQuestionnaire = (requestText: string): QuestionnaireQuestion[] => {
  return isProductRequest(requestText) ? productQuestionnaire(requestText) : serviceQuestionnaire(requestText);
};

export const buildRequestWithAnswers = (requestText: string, answers: QuestionnaireAnswer[] | undefined): string => {
  if (!answers || answers.length === 0) {
    return requestText.trim();
  }

  const validAnswers = answers
    .map((row) => ({
      prompt: row.prompt?.trim() || "",
      answer: row.answer?.trim() || ""
    }))
    .filter((row) => row.answer.length > 0);

  if (validAnswers.length === 0) {
    return requestText.trim();
  }

  const lines = validAnswers.map((row, idx) => `${idx + 1}. ${row.prompt} ${row.answer}`);
  return `${requestText.trim()}\n\nConsumer requirements:\n${lines.join("\n")}`;
};
