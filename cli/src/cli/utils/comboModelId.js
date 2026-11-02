const { isString } = require("../../../../src/shared/utils/typeChecks.cjs");

function nonEmpty(value) {
  return isString(value) && value !== "";
}

function comboModelId(model) {
  if (nonEmpty(model)) return model;
  if (nonEmpty(model?.fullModel)) return model.fullModel;
  if (nonEmpty(model?.provider) && nonEmpty(model?.model)) {
    return `${model.provider}/${model.model}`;
  }
  return null;
}

module.exports = { comboModelId };
