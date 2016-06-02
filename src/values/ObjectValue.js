'use strict';
/* @flow */

const Value = require('../Value');
const PropertyDescriptor = require('./PropertyDescriptor');
const CompletionRecord = require('../CompletionRecord');
const PrimitiveValue = require('./PrimitiveValue');
const NullValue = require('./NullValue');

/**
 * Represents an Object.
 */
class ObjectValue extends Value {

	constructor(realm, proto) {
		super();
		this.extensable = true;
		if ( proto ) this.eraseAndSetPrototype(proto);
		else if ( realm ) this.eraseAndSetPrototype(realm.ObjectPrototype);
		else this.properties = Object.create(null);
	}

	ref(name, ctxthis) {
		var existing = this.properties[name];
		let thiz = this;
		var ret = {};

		let get;
		if ( existing ) {
			ret.isVariable = existing.isVariable;
			ret.del = (s) => {
				return this.delete(name, s);
			};
			ret.getValue = existing.getValue.bind(existing, ctxthis || this);
			ret.setValue = this.set.bind(this, name);
		} else {
			ret.isVariable = false;
			ret.del = (s) => false;
			ret.getValue = function *() { return Value.undef; };
			ret.setValue = function *(to, s) { return yield * thiz.set(name, to, s); };
		}
		return ret;
	}

	*set(name, value, s, extra) {
		extra = extra || {};
		if ( !Object.prototype.hasOwnProperty.call(this.properties, name) ) {
			if ( !this.extensable ) {
				//TODO: Should we throw here in strict mode?
				return;
			}
			let v = new PropertyDescriptor(value);
			v.del = () => this.delete(name);
			v.enumerable = 'enumerable' in extra ? extra.enumerable : true;
			this.properties[name] = v;

			return yield * v.setValue(this, value, s);
		}

		return yield * this.properties[name].setValue(this, value, s);

	}

	rawSetProperty(name, value) {
		this.properties[name] = value;
	}

	setImmediate(name, value) {
		return Value.syncGenHelper(this.set(name, value, this.realm));
	}


	has(name) {
		return name in this.properties;
	}

	delete(name, s) {
		let po = this.properties[name];
		if ( !po.configurable ) {
			if ( s.strict ) return CompletionRecord.makeTypeError(s.realm, "Can't delete nonconfigurable object");
			else return false;
		}
		return delete this.properties[name];
	}

	toNative() {

		//TODO: This is really a mess and should maybe be somewhere else.
		var bk = Value.createNativeBookmark(this);
		if ( this.jsTypeName === 'function' ) return bk;

		for ( let p in this.properties ) {
			let po = this.properties[p];
			if ( Object.prototype.hasOwnProperty.call(bk, p) ) continue;
			if ( bk[p] !== undefined ) continue;

			Object.defineProperty(bk, p, {
				get: () => {
					var c = this.properties[p].value;
					return c === undefined ? undefined : c.toNative();
				},
				set: (v) => { this.properties[p].value = Value.fromNative(v, this.realm); },
				enumerable: po.enumerable,
				configurable: po.configurable
			});
		}
		return bk;

	}


	*add(other) { return yield * (yield * this.toPrimitiveValue()).add(other); }
	*doubleEquals(other) {
		if ( other instanceof PrimitiveValue ) {
			let hint = ( other.jsTypeName == 'string' ? 'string' : 'number' );
			let pv = yield * this.toPrimitiveValue(hint);
			return yield * pv.doubleEquals(other);
		}
		let pthis = yield * this.toPrimitiveValue('string');
		return yield * pthis.doubleEquals(other);
	}
	*inOperator(str) {
		let svalue = yield * str.toStringValue();
		return this.has(svalue.toNative()) ? Value.true : Value.false;
	}

	*get(name, realm, ctxthis) {
		let ref = this.ref(name, ctxthis || this);
		if ( ref ) return yield * ref.getValue();
		return Value.undef;
	}

	*instanceOf(other, realm) {
		return yield * other.constructorOf(this, realm);
	}

	*constructorOf(what, realm) {
		let target = yield * this.get('prototype');
		let pt = what.getPrototype(realm);
		let checked = [];

		while ( pt ) {
			if ( pt === target ) return Value.true;
			checked.push(pt);
			pt = pt.getPrototype(realm);
			if ( checked.indexOf(pt) !== -1 ) return Value.false;
		}
		return Value.false;
	}

	*observableProperties() {
		for ( let p in this.properties ) {
			if ( !this.properties[p].enumerable ) continue;
			yield this.fromNative(p);
		}
		return;
	}

	hasOwnProperty(name) {
		return Object.prototype.hasOwnProperty.call(this.properties, name);
	}

	setPrototype(val) {
		if ( !this.properties ) return this.eraseAndSetPrototype(val);
		if ( val === null || val === undefined || val instanceof NullValue ) {
			Object.setPrototypeOf(this.properties, null);
			this.proto = null;
			return;
		}
		this.proto = val;
		Object.setPrototypeOf(this.properties, val.properties);
	}

	eraseAndSetPrototype(val) {
		if ( val === null || val === undefined || val instanceof NullValue ) {
			this.proto = null;
			this.properties = Object.create(null);
		} else {
			this.proto = val;
			this.properties = Object.create(val.properties);
		}
	}

	getPrototype() {
		return this.proto;
	}

	get debugString() {
		let strProps = ['{','[', this.clazz,']'];
		let delim = [];
		if ( this.wellKnownName ) {
			strProps.push('(', this.wellKnownName , ')');
		}
		if ( this.proto ) {
			delim.push('[[Prototype]]: ' + (this.proto.wellKnownName || this.proto.clazz || this.proto.jsTypeName) );
		}
		for ( let n in this.properties ) {
			if ( !Object.prototype.hasOwnProperty.call(this.properties, n) ) continue;
			let  val = this.properties[n].value;
			if ( this.properties[n].getter || this.properties[n].setter ) delim.push(n + ': [Getter/Setter]');
			else if ( val.specTypeName === 'object' ) delim.push(n + ': [Object]');
			else if ( val.specTypeName === 'function' ) delim.push(n + ': [Function]');
			else delim.push(n + ': ' + val.debugString);
		}
		strProps.push(delim.join(', '));
		strProps.push('} ]');
		return strProps.join(' ');
	}

	*toPrimitiveValue(preferedType) {
		let methodNames;
		if ( preferedType == 'string') {
			methodNames = ['toString', 'valueOf'];
		} else {
			methodNames = ['valueOf', 'toString'];
		}

		for ( let name of methodNames ) {
			let method = yield * this.get(name);
			if ( method && method.call ) {
				let rescr = yield (yield * method.call(this, [])); //TODO: There should be more aruments here
				let res = Value.undef;
				if ( !(rescr instanceof CompletionRecord) ) res = rescr;
				else if ( rescr.type == CompletionRecord.RETURN ) res = rescr.value;
				else if ( rescr.type != CompletionRecord.NORMAL ) continue;
				if ( res.specTypeName !== 'object' ) return res;
			}
		}
		return yield CompletionRecord.makeTypeError(this.realm, 'Cannot convert object to primitive value');
	}

	*toNumberValue() {
		let prim = yield * this.toPrimitiveValue('number');
		return yield * prim.toNumberValue();
	}

	*toObjectValue(realm) { return this; }

	*toStringValue() {
		let prim = yield * this.toPrimitiveValue('string');
		let gen = prim.toStringValue();
		return yield * gen;
	}

	get truthy() {
		return true;
	}

	get jsTypeName() {
		if ( typeof this.call !== 'function' ) return 'object';
		return 'function';
	}

	get specTypeName() {
		return 'object';
	}
}

ObjectValue.prototype.clazz = 'Object';

module.exports = ObjectValue;
