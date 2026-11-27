// E30 (decyzja 32): logowanie przez OpenRouter — wybór darmowego modelu
// z narzędziami i adres powrotu (web/account/js/account-openrouter.js).
import test from "node:test";
import assert from "node:assert/strict";
import { pickFreeModel, callbackUrl } from "../../web/account/js/account-openrouter.js";

const m = (id, tools = true, prompt = "0", completion = "0") => ({ id, supported_parameters: tools ? ["tools", "temperature"] : ["temperature"], pricing: { prompt, completion } });

test("darmowy model: tylko z narzędziami, rodziny w kolejności preferencji", () => {
  assert.equal(pickFreeModel([
    m("meta-llama/llama-3.3-70b-instruct:free"),
    m("google/gemini-2.0-flash-exp:free"),
    m("openai/gpt-5", true, "0.000002", "0.000008"),
  ]), "google/gemini-2.0-flash-exp:free");
  assert.equal(pickFreeModel([m("google/gemini-2.0-flash-exp:free", false), m("qwen/qwen3-235b-a22b:free")]), "qwen/qwen3-235b-a22b:free");
  assert.equal(pickFreeModel([m("some/model-x:free")]), "some/model-x:free", "dowolny darmowy z narzędziami");
  assert.equal(pickFreeModel([m("paid/model", true, "0.1", "0.1"), m("x:free", false)]), "", "brak darmowego z narzędziami");
  assert.equal(pickFreeModel([]), "");
});

test("adres powrotu: Ustawienia konta z ?openrouter=1", () => {
  assert.equal(callbackUrl("https://www.familijna.app"), "https://www.familijna.app/account/?openrouter=1");
});
