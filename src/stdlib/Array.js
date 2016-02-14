"use strict";

const EasyObjectValue = require('../values/EasyObjectValue');
const ObjectValue = require('../values/ObjectValue');
const ArrayValue = require('../values/ArrayValue');

class ArrayObject extends EasyObjectValue {
	*call(thiz, args, s) {
		return ArrayValue.make(args, s.env);
	}

	callPrototype(env) { return env.ArrayPrototype; }
	//objPrototype(env) { return env.Function; }



	static *isArray(thiz, args) {
		if ( args.length < 1 ) return EasyObjectValue.false;
		return EasyObjectValue.fromNative(args[0] instanceof ArrayValue);
	}
}

module.exports = ArrayObject;
